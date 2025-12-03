// Types for London City Council meeting data

export interface TranscriptSegment {
  index: number;
  start: string;
  end: string;
  text: string;
}

export interface Meeting {
  title: string;
  datetime: string;
  url: string | null;
  meeting_type: string;
  present: string[];
  also_present?: string[];
  absent?: string[];
  remote_attendance?: string[];
  content: Content;
  items: Record<string, MeetingItem>;
  bills?: {
    bills: Bill[];
  };
  transcript?: TranscriptSegment[];
  transcript_source?: string;
  transcript_source_url?: string;
  data_sources?: {
    official_minutes: boolean;
    transcript: boolean;
  };
  news_coverage?: NewsCoverage[];
}

export interface NewsCoverage {
  source: string;
  url: string;
  title: string;
  date: string;
  summary: string;
  vote_summary?: string;
  councillors_for?: string[];
  councillors_against?: string[];
}

export interface MeetingItem {
  title: string;
  number: string;
  content: Content[];
  items?: Record<string, MeetingItem>;
  datetime?: string;
  attachments?: any[];
}

export interface Content {
  string?: string;
  __class__?: string;
  pre_motion_texts?: Content[];
  moved_by?: Content;
  seconded_by?: Content;
  motion_texts?: Content[];
  vote?: Vote;
  result?: Content;
}

export interface Vote {
  rows: VoteRow[];
}

export interface VoteRow {
  vote: string;
  voters: string[];
}

export interface Bill {
  title: string;
  desc: string;
  __class__: string;
}

// Types for embeddings and RAG

export interface EmbeddingChunk {
  id: string;
  text: string;
  embedding?: number[];
  metadata: {
    meeting_title: string;
    meeting_date: string;
    meeting_type: string;
    meeting_url: string | null;
    item_number?: string;
    item_title?: string;
    chunk_type: 'motion' | 'content' | 'bill' | 'attendance' | 'transcript';
    file_path: string;
    transcript_start?: string;
    transcript_end?: string;
    has_official_minutes?: boolean;  // false = transcript-only, no vote records
  };
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  message: string;
  history?: ChatMessage[];
}

export interface SearchResult {
  text: string;
  score: number;
  metadata: EmbeddingChunk['metadata'];
}
