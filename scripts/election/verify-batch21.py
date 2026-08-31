#!/usr/bin/env python3
"""Dev tool: print one motion's full text, mover, result, and vote rows
straight from a raw meeting JSON file by (meeting-slug, item-number) — used
while spot-verifying a classify batch (e.g. batch 21) against the source
record instead of a truncated copy.

Usage: python3 scripts/election/verify-batch21.py <meeting-slug> <item-number>
"""
import json, sys, re, os

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "data")

def load_meeting(slug):
    # slug like "months/2023-10/2023-10-17 17th Meeting of City Council"
    path = slug.replace("months/", "")
    full = f"{DATA_DIR}/{path}.json"
    with open(full) as f:
        return json.load(f)

def find_item(items_dict, number_parts):
    node = items_dict
    for i, part in enumerate(number_parts):
        if part not in node:
            return None
        node = node[part]
        if i < len(number_parts) - 1:
            node = node.get("items", {})
    return node

def get_item(meeting, item_number):
    parts = item_number.split(".")
    node = find_item(meeting["items"], parts)
    return node

def print_item(meeting_json_path, item_number, title_filter=None):
    meeting = load_meeting(meeting_json_path)
    item = get_item(meeting, item_number)
    if item is None:
        print(f"ITEM NOT FOUND: {item_number}")
        return
    print(f"=== ITEM {item_number}: {item.get('title')} ===")
    for c in item.get("content", []):
        if c.get("__class__") != "Motion":
            continue
        motion_texts = c.get("motion_texts", [])
        full_text = " ".join(m.get("string","") for m in motion_texts)
        pre = c.get("pre_motion_texts", [])
        pre_text = " ".join(p.get("string","") if isinstance(p, dict) else str(p) for p in pre)
        result = c.get("result", {}).get("string")
        mover = c.get("moved_by", {}).get("string")
        print(f"--- MOTION (mover: {mover}) result: {result} ---")
        if pre_text.strip():
            print(f"[PRE-MOTION TEXT]: {pre_text}")
        print(f"[MOTION TEXT]: {full_text}")
        vote = c.get("vote", {})
        for row in vote.get("rows", []):
            print(f"  {row.get('vote')} {row.get('voters')}")
        print()
    # Also print sub-items titles for context
    subitems = item.get("items", {})
    if subitems:
        print(f"[Sub-items]: {list(subitems.keys())}")

if __name__ == "__main__":
    slug = sys.argv[1]
    item_number = sys.argv[2]
    print_item(slug, item_number)
