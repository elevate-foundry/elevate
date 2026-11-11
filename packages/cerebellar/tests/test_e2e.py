"""
End-to-end smoke test for the aCBL Streamlit app.
Launches the app, enters a name, verifies the BBID handshake completes.

Requirements:
- API keys in .env (MAMMOUTH_API_KEY, OPENROUTER_API_KEY)
- pip install playwright && playwright install chromium
- pip install pytest-playwright

Run with: pytest tests/test_e2e.py -v --timeout=120
"""
import subprocess
import time
import os
import signal
import pytest
from playwright.sync_api import sync_playwright, expect


STREAMLIT_PORT = 8502  # Use non-default port to avoid conflicts
APP_URL = f"http://localhost:{STREAMLIT_PORT}"
APP_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "app.py")


@pytest.fixture(scope="module")
def streamlit_app():
    """Start the Streamlit app as a subprocess."""
    env = os.environ.copy()
    proc = subprocess.Popen(
        [
            "streamlit", "run", APP_PATH,
            "--server.port", str(STREAMLIT_PORT),
            "--server.headless", "true",
            "--browser.gatherUsageStats", "false",
        ],
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        cwd=os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    )
    # Wait for app to be ready
    time.sleep(8)
    yield proc
    # Cleanup
    proc.send_signal(signal.SIGTERM)
    proc.wait(timeout=10)


@pytest.fixture(scope="module")
def browser_page(streamlit_app):
    """Create a Playwright browser page."""
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context()
        page = context.new_page()
        yield page
        browser.close()


class TestE2ESmoke:
    """End-to-end smoke test: app loads, name entry works, BBID appears."""

    def test_app_loads(self, browser_page):
        """Verify the app loads and shows the title."""
        browser_page.goto(APP_URL, wait_until="networkidle")
        # Should see the cerebellar loop title
        expect(browser_page.locator("text=Cerebellar Braille Loop")).to_be_visible(timeout=15000)

    def test_name_input_visible(self, browser_page):
        """Verify the name input is visible."""
        browser_page.goto(APP_URL, wait_until="networkidle")
        # Should see the prompt for name
        expect(browser_page.locator("text=What's your name")).to_be_visible(timeout=15000)

    def test_identify_button_visible(self, browser_page):
        """Verify the Identify button is present."""
        browser_page.goto(APP_URL, wait_until="networkidle")
        identify_btn = browser_page.get_by_role("button", name="Identify")
        expect(identify_btn).to_be_visible(timeout=15000)

    def test_bbid_handshake(self, browser_page):
        """
        Full E2E: enter a name, click Identify, wait for BBID.
        This calls real APIs and costs tokens.
        """
        browser_page.goto(APP_URL, wait_until="networkidle")

        # Enter name
        name_input = browser_page.locator("input[type='text']").first
        name_input.fill("test")

        # Click Identify
        identify_btn = browser_page.get_by_role("button", name="Identify")
        identify_btn.click()

        # Wait for BBID to appear (up to 90 seconds for API calls)
        # After handshake, the app shows "BBID verified" or "BBID by majority"
        bbid_locator = browser_page.locator("text=/BBID/")
        expect(bbid_locator).to_be_visible(timeout=90000)

        # Verify braille is present in the output
        page_content = browser_page.content()
        # Should contain braille Unicode characters
        has_braille = any(
            0x2800 <= ord(ch) <= 0x28FF
            for ch in page_content
        )
        assert has_braille, "Expected braille characters in BBID output"

    def test_reset_button_works(self, browser_page):
        """After BBID handshake, 'Not me' button should reset state."""
        # If previous test passed, we should be on the identified page
        not_me_btn = browser_page.get_by_role("button", name="Not me")
        if not_me_btn.is_visible():
            not_me_btn.click()
            # Should go back to name input
            expect(browser_page.locator("text=What's your name")).to_be_visible(timeout=15000)
