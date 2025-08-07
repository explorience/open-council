# Open Council

Open Council scrapes London council meetings, nicely formats them, and parses the data into an easy-to-work-with JSON format.

## Folders

- [`scraping/`](scraping/): Python scraping scripts
- [`data/`](data/): outputted JSON data
- [`content/`](content/): formatted markdown

## Scripts

To serve the site, run `npm run dev` in this directory.

To scrape, run `uv run main.py` in the [`scraping/`](scraping/) directory. This will find all new meetings in the past 6 months, and process them. It determines which meetings have already been scraped from the `data/` folder.

You can also run something like
```
uv run main.py 'Community and Protective Services Committee' '2025-05-20'
```
to scrape a specific meeting from its meeting type and date. The name of the meeting comes from the [eScribe's meeting types](https://pub-london.escribemeetings.com/?MeetingViewId=1) (the name of the collapsible)

## Data

JSON data for meetings is available in [`data/YYYY-MM/`](data/) folders. This JSON data is serialized (quickly and dirtly) from the Python classes in the [`scraping/`](scraping/) directory. Each object has a `__class__` property that identifies its class. Here is some pseudocode for the format:

```ocaml
File : Meeting

class Meeting:
  (* Meeting title (and sometimes... meetings don't have titles.) *)
  title : String | null

  (* YYYY-MM-DD HH:MM:SS, in London's time zone *)
  datetime : String

  (* Link to the original meeting minutes *)
  url : String

  (* An option from the dropdowns in https://pub-london.escribemeetings.com/?MeetingViewId=1 *)
  meeting_type : String

  (* Bills passed this meeting (only present at Council meetings) *)
  bills : null | Bills

  (* Attendees lists - may contain improperly split names or fragments of titles; I try my best to clean this up but some edge cases surely elude me *)
  present : [String]
  also_present : [String]
  absent : [String]
  remote_attendance : [String]

  (* Brief text before the items ("this meeting called to order at ..." etc) *)
  content : Content | Paragraph

  (* The key of each subitem is usually a number ("1", "2"), but may occasionally be a letter (such as "a") *)
  items : Dict(String, MeetingItem)

class Bills:
  bills : [Bill]

class Bill:
  title : String
  desc : String

class MeetingItem:
  title : String

  (* Same as the key for the dict in which this item resides (see `items` above) *)
  number : String

  (* Subitems *)
  items : Dict(String, MeetingItem)

  content : [Content | Paragraph | Motion]

  (* Relevant attachments *)
  attachments : [Attachment]

  (* Relevant report for this subitem, if report has already been processed and is in the data.
   For example, if section 8.1 is "budget committee meeting", and this item is 8.1.3, "section 4.3 from budget committee meeting", this would hold the path to the budget committee meeting
   In other words, this holds a path to the parent's Attachment *)
  report : String | null

class Attachment:
  (* Link to attachment *)
  url : String

  (* YYYY-MM-DD, date of attached meeting/report *)
  date : String | null

  (* Path to local file if the meeting is in data *)
  local_page : String | null

class Motion:
  pre_motion_texts : [Content | Paragraph]
  moved_by : Mover
  seconded_by : Mover
  motion_texts : [Content | Paragraph]
  vote : Vote
  result : MotionResult
  post_motion_texts : [Content | Paragraph]

class Mover:
  (* Name of the person that moved/seconded this motion. Could be an empty string if the motion didn't need someone to move/second. *)
  string : String

class Vote:
  (* This could be an empty list due to document quirks *)
  rows: [{
    (* Such as "Yeas" or "Nays" or "Absent" *)
    "vote" : String

    (* List of names *)
    "voters" : [String]
  }]

class MotionResult
  (* eg "Motion Passed (15 to 0)" or "Motion Failed (5 to 10)". Could also be an empty string if inconclusive (such as if it was amended) *)
  string : String

class Content:
  (* Completely empty, for indicating that there is no content *)

class Paragraph:
  string : String
```
