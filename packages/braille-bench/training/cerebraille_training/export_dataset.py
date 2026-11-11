import argparse
import json
from pathlib import Path

import requests

DEFAULT_EXAMPLES = [
    ("latex", "\\documentclass{article}\\begin{document}the model and the compression\\end{document}"),
    ("latex", "\\section{Introduction} the model is a compression system"),
    ("prose", "the model and the compression of semantic information"),
    ("prose", "photosynthesis uses sunlight water and carbon dioxide"),
    ("code", "def function return true if false else return false"),
    ("structured", "Jupiter Saturn Uranus Neptune Earth diameter kilometers"),
]


def encode(server: str, text: str, domain: str) -> dict:
    query = """
    mutation Encode($text: String!, $domain: CerebrailleDomain!, $fidelityMode: FidelityMode!) {
      encode(text: $text, domain: $domain, fidelityMode: $fidelityMode) {
        original
        encoded
        decoded
        domain
        exactRoundtrip
        compressionRatio
        codebookVersion
      }
    }
    """
    response = requests.post(
        f"{server.rstrip('/')}/graphql",
        json={"query": query, "variables": {"text": text, "domain": domain, "fidelityMode": "lossless"}},
        timeout=10,
    )
    response.raise_for_status()
    payload = response.json()
    if "errors" in payload:
        raise RuntimeError(payload["errors"])
    return payload["data"]["encode"]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--server", default="http://localhost:3900")
    parser.add_argument("--out", default="data/cerebraille_pairs.jsonl")
    args = parser.parse_args()

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)

    rows = []
    for domain, text in DEFAULT_EXAMPLES:
        result = encode(args.server, text, domain)
        rows.append({
            "source": result["original"],
            "encoded": result["encoded"],
            "decoded": result["decoded"],
            "domain": result["domain"],
            "exact_roundtrip": result["exactRoundtrip"],
            "compression_ratio": result["compressionRatio"],
            "codebook_version": result["codebookVersion"],
        })

    with out.open("w") as f:
        for row in rows:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")

    print(f"wrote {len(rows)} examples to {out}")


if __name__ == "__main__":
    main()
