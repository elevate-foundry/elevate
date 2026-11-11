import json
from dataclasses import dataclass
from pathlib import Path

import torch
from torch.utils.data import Dataset

TEXT_BASE = 256
BRAILLE_BASE = 0x2800
BRAILLE_VOCAB = 256
BOS = TEXT_BASE + BRAILLE_VOCAB
SEP = BOS + 1
EOS = BOS + 2
PAD = BOS + 3
VOCAB_SIZE = PAD + 1


@dataclass(frozen=True)
class CerebraillePair:
    source: str
    encoded: str
    domain: str = "mixed"


def encode_text(text: str) -> list[int]:
    return [min(ord(ch), 255) for ch in text]


def encode_braille(text: str) -> list[int]:
    tokens: list[int] = []
    for ch in text:
        codepoint = ord(ch)
        if BRAILLE_BASE <= codepoint <= BRAILLE_BASE + 255:
            tokens.append(TEXT_BASE + codepoint - BRAILLE_BASE)
        else:
            tokens.append(min(codepoint, 255))
    return tokens


def load_pairs(path: Path) -> list[CerebraillePair]:
    pairs: list[CerebraillePair] = []
    with path.open() as f:
        for line in f:
            if not line.strip():
                continue
            item = json.loads(line)
            pairs.append(CerebraillePair(source=item["source"], encoded=item["encoded"], domain=item.get("domain", "mixed")))
    return pairs


class CerebrailleAutoregressiveDataset(Dataset[tuple[torch.Tensor, torch.Tensor]]):
    def __init__(self, pairs: list[CerebraillePair], max_length: int = 512) -> None:
        self.pairs = pairs
        self.max_length = max_length

    def __len__(self) -> int:
        return len(self.pairs)

    def __getitem__(self, index: int) -> tuple[torch.Tensor, torch.Tensor]:
        pair = self.pairs[index]
        tokens = [BOS] + encode_text(pair.source) + [SEP] + encode_braille(pair.encoded) + [EOS]
        tokens = tokens[: self.max_length]
        x = tokens[:-1]
        y = tokens[1:]
        return torch.tensor(x, dtype=torch.long), torch.tensor(y, dtype=torch.long)


def collate_batch(batch: list[tuple[torch.Tensor, torch.Tensor]]) -> tuple[torch.Tensor, torch.Tensor]:
    max_len = max(x.numel() for x, _ in batch)
    xs = torch.full((len(batch), max_len), PAD, dtype=torch.long)
    ys = torch.full((len(batch), max_len), PAD, dtype=torch.long)
    for i, (x, y) in enumerate(batch):
        xs[i, : x.numel()] = x
        ys[i, : y.numel()] = y
    return xs, ys
