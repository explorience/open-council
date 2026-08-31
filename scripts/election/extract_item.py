#!/usr/bin/env python3
"""Dev tool: dump one agenda item's full text (motions, pre/post text,
result, vote rows) straight from a raw meeting JSON file, recursively
through its sub-items. Used to re-read a motion's COMPLETE text against the
source record while verifying a classify batch (see
data/election/classify/batch-*-verified.json) — never rely on the
500-char-truncated copy in data/votes/_all-motions.json.

Usage: python3 scripts/election/extract_item.py <meeting-json-path> <item-number>
"""
import json, sys

def navigate(items, parts):
    node = None
    cur = items
    for p in parts:
        node = cur[p]
        cur = node.get('items', {})
    return node

def dump_node(node, prefix=""):
    title = node.get('title','')
    number = node.get('number','')
    print(f"{prefix}=== ITEM {number}: {title} ===")
    for c in node.get('content', []):
        if c.get('__class__') == 'Motion' or 'motion_texts' in c:
            print(f"{prefix}--- MOTION ---")
            mb = c.get('moved_by',{}).get('string','')
            sb = c.get('seconded_by',{}).get('string','')
            print(f"{prefix}{mb} / {sb}")
            for pre in c.get('pre_motion_texts', []):
                s = pre.get('string') if isinstance(pre, dict) else pre
                print(f"{prefix}[PRE] {s}")
            for mt in c.get('motion_texts', []):
                s = mt.get('string') if isinstance(mt, dict) else mt
                print(f"{prefix}{s}")
            for post in c.get('post_motion_texts', []):
                s = post.get('string') if isinstance(post, dict) else post
                print(f"{prefix}[POST] {s}")
            res = c.get('result',{})
            print(f"{prefix}RESULT: {res.get('string','')}")
            vote = c.get('vote',{})
            for row in vote.get('rows', []):
                print(f"{prefix}  {row.get('vote')} {row.get('voters')}")
        else:
            # generic content paragraph
            s = c.get('string') if isinstance(c, dict) else c
            if s:
                print(f"{prefix}[TEXT] {s}")
    for k, sub in node.get('items', {}).items():
        dump_node(sub, prefix + "  ")

if __name__ == "__main__":
    meeting_file = sys.argv[1]
    item_number = sys.argv[2]
    with open(meeting_file) as f:
        d = json.load(f)
    items = d['items']
    parts = item_number.split('.')
    node = navigate(items, parts)
    dump_node(node)
