"""Entry point: `python3 -m famulus.bootstrap` (invoked by bootstrap.sh)."""

from .wizard import main

if __name__ == "__main__":
    raise SystemExit(main())
