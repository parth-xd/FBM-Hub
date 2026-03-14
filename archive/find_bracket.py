import sys

with open('public/index.html') as f:
    content = f.read()

start = content.find('<script type="text/babel">')
end = content.find('</script>', start)
js = content[start:end]
lines = js.split('\n')

depth = 0
imbalance_starts = []
for i, line in enumerate(lines):
    old_depth = depth
    for ch in line:
        if ch == '[': depth += 1
        elif ch == ']': depth -= 1
    if old_depth == 0 and depth > 0:
        actual_line = content[:start].count('\n') + i + 1
        opens = line.count('[')
        closes = line.count(']')
        imbalance_starts.append((actual_line, opens, closes, line.strip()[:200]))
    elif depth == 0 and old_depth > 0:
        actual_line = content[:start].count('\n') + i + 1
        if imbalance_starts:
            s = imbalance_starts[-1]
            # This was a balanced section, remove it
            imbalance_starts.pop()

# Remaining imbalance_starts are truly unmatched
for s in imbalance_starts:
    print(f'UNMATCHED [ at line {s[0]}: opens={s[1]}, closes={s[2]}')
    print(f'  {s[3]}')

print(f'\nFinal bracket depth: {depth}')
