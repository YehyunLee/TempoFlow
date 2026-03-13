import json
import pandas as pd
import matplotlib.pyplot as plt
import re
import numpy as np

# 1. Load Data
with open('gsm8k_results.json', 'r') as f:
    data = json.load(f)

results = []
for item in data:
    q = str(item.get('question', ''))
    a = str(item.get('completion', ''))
    corr = bool(item.get('is_correct', False))
    
    # use REGEX: looks for num = num
    equations = re.findall(r'\d+\s*=\s*\d+', q)
    q_eq_count = len(equations)
    
    # ensure no 0: If the regex missed a step like "4 + 1 = 5" due to formatting,
    # we count the '=' signs directly to ensure we don't get 0.
    if q_eq_count == 0 and '=' in q:
        q_eq_count = q.count('=')
    
    results.append({
        'q_equations': q_eq_count,
        'a_steps': len(re.findall(r'\[calc\]', a, re.IGNORECASE)),
        'is_correct': corr
    })

df = pd.DataFrame(results)

# 2. Setup Figure (1x3 Grid)
fig, (ax1, ax2, ax3) = plt.subplots(1, 3, figsize=(26, 8))

def plot_robust_bars(axis, groupby_col, title, xlabel):
    stats = {}
    for _, row in df.iterrows():
        val = row[groupby_col]
        res = row['is_correct']
        if val not in stats: stats[val] = {True: 0, False: 0}
        stats[val][res] += 1
    
    sorted_keys = sorted(stats.keys())
    correct = [stats[k][True] for k in sorted_keys]
    incorrect = [stats[k][False] for k in sorted_keys]
    totals = [c + i for c, i in zip(correct, incorrect)]
    
    axis.bar(sorted_keys, correct, color='#27ae60', label='Correct', alpha=0.8)
    axis.bar(sorted_keys, incorrect, bottom=correct, color='#c0392b', label='Incorrect', alpha=0.8)
    
    for i, k in enumerate(sorted_keys):
        acc = (correct[i] / totals[i] * 100) if totals[i] > 0 else 0
        axis.text(k, totals[i] + 0.5, f"{acc:.1f}%\n(n={totals[i]})", 
                  ha='center', fontweight='bold', fontsize=9)
    
    axis.set_title(title, fontweight='bold', fontsize=13)
    axis.set_xlabel(xlabel)
    axis.set_ylabel('Number of Problems')
    axis.legend()

# --- Plot 1: Model Effort ---
plot_robust_bars(ax1, 'a_steps', 'Accuracy by Answer Steps', 'Number of [CALC] steps')

# --- Plot 2: Question Complexity ---
plot_robust_bars(ax2, 'q_equations', 'Accuracy by Question Complexity', 'Number of Equations in Q')

# --- Plot 3: Alignment Scatter ---
jitter = 0.15
q_jitter = df['q_equations'] + np.random.uniform(-jitter, jitter, len(df))
a_jitter = df['a_steps'] + np.random.uniform(-jitter, jitter, len(df))

ax3.scatter(q_jitter[df['is_correct'] == True], a_jitter[df['is_correct'] == True], 
            color='#27ae60', alpha=0.4, label='Correct', edgecolors='white', linewidth=0.3)
ax3.scatter(q_jitter[df['is_correct'] == False], a_jitter[df['is_correct'] == False], 
            color='#c0392b', alpha=0.4, label='Incorrect', edgecolors='white', linewidth=0.3)

coord_stats = df.groupby(['q_equations', 'a_steps'])['is_correct'].agg(['mean']).reset_index()
for _, row in coord_stats.iterrows():
    ax3.text(row['q_equations'], row['a_steps'] + 0.2, f"{row['mean']*100:.0f}%", 
             ha='center', fontsize=8, fontweight='bold', bbox=dict(facecolor='white', alpha=0.7, edgecolor='none'))

max_val = max(df['q_equations'].max(), df['a_steps'].max())
ax3.plot([0, max_val], [0, max_val], 'k--', alpha=0.3, label='1:1 Alignment')
ax3.set_title('Complexity vs. Effort Alignment', fontweight='bold', fontsize=13)
ax3.set_xlabel('Equations in Question')
ax3.set_ylabel('Steps in Answer')
ax3.legend()

plt.tight_layout()
plt.savefig('gsm8k_visualizaion_3plots.png')
print("Saved to gsm8k_visualizaion_3plots.png")