"""
Needle-in-a-haystack evaluation for RoPE vs ALiBi ablation.

Evaluates a base model on:
  - 512-length context (control, within training length)
  - 1030-length context (beyond training length for 512-trained models)

Metrics:
  - Accuracy: exact password retrieval (model output contains the needle password).
  - Robustness: success rate over N seeds × placements.
  - Distance curve: success rate vs needle placement (0%, 25%, 50%, 75%, 100%).
  - BPB on the full prompt (lower = better use of long context).

Usage (ALiBi checkpoint, e.g. after stage_pretrain_ablation_alibi):
  python -m scripts.needle_ablation_eval --model-tag d12-seq512-alibi

Usage (RoPE baseline - run this same script in nanochat-exp-swiglu-activation):
  python -m scripts.needle_ablation_eval --model-tag d12-seq512

Optional:
  --context-lengths 512 1030
  --num-seeds 5
  --placements 0 0.25 0.5 0.75 1.0
  --output results.json
  --modal  (use Modal volume paths)
"""

import os
import sys
import json
import argparse
import random
from collections import defaultdict
from contextlib import nullcontext

import torch

from nanochat.checkpoint_manager import load_model
from nanochat.engine import Engine
from nanochat.common import print0, autodetect_device_type, compute_init


# Default needle and expected password (substring match in model output)
DEFAULT_NEEDLE = "The secret password is: ALIBI_IS_AWESOME."
DEFAULT_PASSWORD = "ALIBI_IS_AWESOME"
DEFAULT_QUESTION = "\n\nBased on the text above, what is the secret password?"


def build_context_to_length(tokenizer, needle_ids, filler_ids, target_tokens, placement):
    """
    Build context token list of exactly target_tokens with needle at placement.
    placement in [0, 1]: fraction of context before the needle.
    """
    n_needle = len(needle_ids)
    if n_needle >= target_tokens:
        raise ValueError(f"needle length {n_needle} >= target_tokens {target_tokens}")
    before = int(placement * (target_tokens - n_needle))
    after = target_tokens - n_needle - before
    # Filler may be shorter than before+after; cycle if needed
    f = filler_ids
    while len(f) < max(before, after):
        f = f + f
    context_ids = f[:before] + needle_ids + f[:after]
    assert len(context_ids) == target_tokens
    return context_ids


def run_one(
    model, tokenizer, engine, device, prompt_ids, autocast_ctx, max_new_tokens=30, temperature=0
):
    """Generate answer and compute BPB on prompt. Returns (output_str, bpb)."""
    with torch.no_grad(), autocast_ctx:
        ids = torch.tensor([prompt_ids], dtype=torch.long, device=device)
        targets = ids.clone()
        targets[:, :-1] = ids[:, 1:]
        targets[:, -1] = -1
        loss = model(ids, targets=targets)
        bpb = loss.item() / 0.693147  # approx bits per byte

    with autocast_ctx:
        stream = engine.generate(prompt_ids, num_samples=1, max_tokens=max_new_tokens, temperature=temperature)
        output_tokens = []
        for token_column, _ in stream:
            output_tokens.append(token_column[0])
    output_str = tokenizer.decode(output_tokens).strip()
    return output_str, bpb


def check_success(output_str, password):
    """True if model output contains the exact password (case-sensitive)."""
    return password in output_str


def main():
    parser = argparse.ArgumentParser(
        description="Needle-in-a-haystack eval for RoPE vs ALiBi ablation"
    )
    parser.add_argument("--model-tag", type=str, required=True, help="Checkpoint tag (e.g. d12-seq512 or d12-seq512-alibi)")
    parser.add_argument("--step", type=int, default=None, help="Checkpoint step to load (default: latest)")
    parser.add_argument(
        "--context-lengths",
        type=int,
        nargs="+",
        default=[512, 1030],
        help="Context lengths to evaluate (default: 512 1030)",
    )
    parser.add_argument("--num-seeds", type=int, default=5, help="Seeds per (context_len, placement) for robustness")
    parser.add_argument(
        "--placements",
        type=float,
        nargs="+",
        default=[0.0, 0.25, 0.5, 0.75, 1.0],
        help="Needle position as fraction of context (0=start, 1=end)",
    )
    parser.add_argument("--needle", type=str, default=DEFAULT_NEEDLE, help="Needle sentence")
    parser.add_argument("--password", type=str, default=DEFAULT_PASSWORD, help="Exact substring to count as success")
    parser.add_argument("--question", type=str, default=DEFAULT_QUESTION, help="Question appended after context")
    parser.add_argument("--filler-seed", type=int, default=42, help="RNG seed for filler token sequence")
    parser.add_argument("--output", type=str, default="", help="Write JSON results to this path")
    parser.add_argument("--device-type", type=str, default="")
    parser.add_argument("--modal", action="store_true", help="Modal path configuration")
    parser.add_argument("--base-dir", type=str, default="", help="Override checkpoint/tokenizer root (path containing base_checkpoints/, tokenizer/). Default: NANOCHAT_BASE_DIR or ~/.cache/nanochat")
    args = parser.parse_args()

    if args.modal:
        sys.argv.append("--modal")
    if args.base_dir:
        expanded = os.path.abspath(os.path.expanduser(args.base_dir))
        # If expanded is the checkpoints dir (contains model_tag), use its parent as base so we don't double-append "base_checkpoints"
        if os.path.isdir(os.path.join(expanded, args.model_tag)):
            os.environ["NANOCHAT_BASE_DIR"] = os.path.dirname(expanded)
        else:
            os.environ["NANOCHAT_BASE_DIR"] = expanded
        print0(f"Using base dir: {os.environ['NANOCHAT_BASE_DIR']}")

    device_type = autodetect_device_type() if args.device_type == "" else args.device_type
    _, _, _, _, device = compute_init(device_type)

    print0(f"Loading model: {args.model_tag}" + (f" step {args.step}" if args.step is not None else " (latest)"))
    model, tokenizer, meta = load_model("base", device, phase="eval", model_tag=args.model_tag, step=args.step)
    engine = Engine(model, tokenizer)
    autocast_ctx = (
        torch.amp.autocast(device_type=device_type, dtype=torch.bfloat16)
        if device_type == "cuda"
        else nullcontext()
    )

    needle_ids = tokenizer.encode(args.needle)
    question_ids = tokenizer.encode(args.question)
    # Filler: deterministic but long token sequence (repeat a sentence)
    rng = random.Random(args.filler_seed)
    base_filler = "The quick brown fox jumps over the lazy dog. "
    base_ids = tokenizer.encode(base_filler)
    filler_ids = base_ids * (max(args.context_lengths) * 2 // len(base_ids) + 1)
    rng.shuffle(filler_ids)  # vary which tokens appear where across runs if we change seed

    results_by_len = defaultdict(lambda: {"success": 0, "total": 0, "bpb": [], "by_placement": defaultdict(lambda: {"success": 0, "total": 0})})

    for context_len in args.context_lengths:
        for placement in args.placements:
            for seed in range(args.num_seeds):
                # Deterministic per (context_len, placement, seed)
                rng_local = random.Random(args.filler_seed + hash((context_len, placement, seed)) % (2**32))
                filler_shuf = filler_ids.copy()
                rng_local.shuffle(filler_shuf)

                try:
                    context_ids = build_context_to_length(
                        tokenizer, needle_ids, filler_shuf, context_len, placement
                    )
                except ValueError as e:
                    print0(f"Skipping context_len={context_len} placement={placement}: {e}")
                    continue

                bos_id = tokenizer.get_bos_token_id()
                prompt_ids = [bos_id] + context_ids + question_ids

                output_str, bpb = run_one(model, tokenizer, engine, device, prompt_ids, autocast_ctx)
                ok = check_success(output_str, args.password)

                results_by_len[context_len]["total"] += 1
                results_by_len[context_len]["by_placement"][placement]["total"] += 1
                if ok:
                    results_by_len[context_len]["success"] += 1
                    results_by_len[context_len]["by_placement"][placement]["success"] += 1
                results_by_len[context_len]["bpb"].append(bpb)

    # Report
    print0("\n" + "=" * 60)
    print0("NEEDLE ABLATION EVAL RESULTS")
    print0("=" * 60)
    print0(f"Model tag: {args.model_tag}")
    print0(f"Context lengths: {args.context_lengths}")
    print0(f"Placements: {args.placements}")
    print0(f"Seeds per (len, placement): {args.num_seeds}")
    print0("")

    summary = {"model_tag": args.model_tag, "context_lengths": {}, "distance_curve": {}}

    for context_len in sorted(results_by_len.keys()):
        r = results_by_len[context_len]
        total = r["total"]
        success = r["success"]
        acc = success / total if total else 0
        bpb_list = r["bpb"]
        bpb_mean = sum(bpb_list) / len(bpb_list) if bpb_list else 0
        bpb_std = (sum((x - bpb_mean) ** 2 for x in bpb_list) / len(bpb_list)) ** 0.5 if len(bpb_list) > 1 else 0

        print0(f"Context length {context_len}")
        print0(f"  Accuracy (exact password): {success}/{total} = {100*acc:.1f}%")
        print0(f"  BPB (mean ± std):          {bpb_mean:.4f} ± {bpb_std:.4f}")
        print0("  Distance curve (success % by placement):")
        for pl in sorted(r["by_placement"].keys()):
            bp = r["by_placement"][pl]
            pct = 100 * bp["success"] / bp["total"] if bp["total"] else 0
            print0(f"    placement {pl:.2f}: {bp['success']}/{bp['total']} = {pct:.1f}%")
        print0("")

        summary["context_lengths"][str(context_len)] = {
            "accuracy": acc,
            "success": success,
            "total": total,
            "bpb_mean": bpb_mean,
            "bpb_std": bpb_std,
        }
        summary["distance_curve"][str(context_len)] = {
            str(pl): {
                "success": r["by_placement"][pl]["success"],
                "total": r["by_placement"][pl]["total"],
            }
            for pl in sorted(r["by_placement"].keys())
        }

    if args.output:
        with open(args.output, "w", encoding="utf-8") as f:
            json.dump(summary, f, indent=2)
        print0(f"Results written to {args.output}")

    return summary


if __name__ == "__main__":
    main()
