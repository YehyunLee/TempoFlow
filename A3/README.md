# CSC490 Assignment A3: Nanochat Pre-training Instructions

This guide provides commands for running the Part 3 Context Extension experiments either locally (on a Mac with MPS) or on Modal (GPU/H100).

---

## 1. Local Execution (Mac/CPU/MPS)
Use these commands if you are running on your own machine. All commands should be run from the `nanochat` directory within the experimental branch folder (e.g., `nanochat-exp-alibi-attention/nanochat`).

### Setup
```bash
pip install rustbpe datasets fastapi psutil python-dotenv regex scipy tabulate tiktoken tokenizers torch transformers uvicorn zstandard
```

### Training
**Phase 1: Short Context (512 tokens)**
```bash
python -m scripts.base_train \
    --depth=12 \
    --max-seq-len=512 \
    --model-tag=pico-part3 \
    --num-iterations=1000 \
    --save-every=500 \
    --run=dummy
```

**Phase 2: Long Context (2048 tokens)**
```bash
python -m scripts.base_train \
    --depth=12 \
    --max-seq-len=2048 \
    --model-tag=pico-part3 \
    --resume-from-step=1000 \
    --num-iterations=2000 \
    --run=dummy
```

### Evaluation
```bash
python -m scripts.part3_eval --model-tag=pico-part3 --step1=1000 --step2=2000
```

---

## 2. Modal Execution (Remote GPU)
Use these commands if you want to use Modal credits. All commands should be run from the experimental branch root (e.g., `nanochat-exp-alibi-attention/`).

### Setup
```bash
# 1. Setup Modal
pip install modal
modal setup

# 2. Create Secrets (Replace with your actual keys)
modal secret create nanochat-secrets \
    WANDB_API_KEY="your_wandb_key" \
    HF_TOKEN="your_hf_token"
```

### Data & Tokenizer (Run once)
```bash
# Download 40 shards (~10GB)
modal run nanochat_modal.py::stage_data --num-shards=40

# Train the tokenizer
modal run nanochat_modal.py::stage_tokenizer
```

### Training
**Phase 1: Short Context (512 tokens)**
```bash
modal run nanochat_modal.py::stage_pretrain \
    --depth=12 \
    --device-batch-size=16 \
    --wandb-run=pico-512 \
    --extra="--max-seq-len=512 --num-iterations=1000 --save-every=500 --model-tag=pico-part3"
```

**Phase 2: Long Context (2048 tokens)**
```bash
modal run nanochat_modal.py::stage_pretrain \
    --depth=12 \
    --device-batch-size=16 \
    --wandb-run=pico-2048 \
    --extra="--max-seq-len=2048 --resume-from-step=1000 --num-iterations=2000 --model-tag=pico-part3"
```

---

## Important Notes
- **Persistence:** On Modal, all data (shards, tokenizer, checkpoints) is saved to the `/vol` persistent volume.
- **`--modal` flag:** The scripts automatically detect if they are running on Modal and adjust their paths accordingly. You do not need to manually change paths in the code.
- **WandB:** If you don't want to use Weights & Biases, set `--run=dummy` (Local) or `--wandb-run=dummy` (Modal).
