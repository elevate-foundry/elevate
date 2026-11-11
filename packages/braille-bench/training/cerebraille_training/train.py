import argparse
from pathlib import Path

import torch
from torch import nn
from torch.utils.data import DataLoader

from cerebraille_training.dataset import PAD, VOCAB_SIZE, CerebrailleAutoregressiveDataset, collate_batch, load_pairs
from cerebraille_training.model import CerebrailleTransformer


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", default="data/cerebraille_pairs.jsonl")
    parser.add_argument("--epochs", type=int, default=1)
    parser.add_argument("--batch-size", type=int, default=4)
    parser.add_argument("--max-length", type=int, default=512)
    parser.add_argument("--lr", type=float, default=3e-4)
    parser.add_argument("--out", default="checkpoints/cerebraille-transformer.pt")
    args = parser.parse_args()

    data_path = Path(args.data)
    pairs = load_pairs(data_path)
    if not pairs:
        raise ValueError(f"no training pairs found in {data_path}")

    dataset = CerebrailleAutoregressiveDataset(pairs, max_length=args.max_length)
    loader = DataLoader(dataset, batch_size=args.batch_size, shuffle=True, collate_fn=collate_batch)

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model = CerebrailleTransformer(vocab_size=VOCAB_SIZE, max_length=args.max_length).to(device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=args.lr)
    criterion = nn.CrossEntropyLoss(ignore_index=PAD)

    model.train()
    for epoch in range(args.epochs):
        total_loss = 0.0
        total_tokens = 0
        for x, y in loader:
            x = x.to(device)
            y = y.to(device)
            logits = model(x)
            loss = criterion(logits.reshape(-1, logits.size(-1)), y.reshape(-1))
            optimizer.zero_grad(set_to_none=True)
            loss.backward()
            optimizer.step()

            tokens = (y != PAD).sum().item()
            total_loss += loss.item() * tokens
            total_tokens += tokens

        avg_loss = total_loss / max(total_tokens, 1)
        print(f"epoch={epoch + 1} loss={avg_loss:.4f} tokens={total_tokens}")

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    torch.save({
        "model_state_dict": model.state_dict(),
        "vocab_size": VOCAB_SIZE,
        "max_length": args.max_length,
        "pairs": len(pairs),
    }, out)
    print(f"saved checkpoint to {out}")


if __name__ == "__main__":
    main()
