/**
 * Type definitions for councillor data
 */

export interface CouncillorTerm {
  start: number
  end: number
  role: "Mayor" | "Councillor"
  ward?: number
}

export interface CouncillorInfo {
  displayName: string
  slug: string
  terms: CouncillorTerm[]
}

export type CouncillorRegistry = Record<string, CouncillorInfo>

export type NameVariationsMap = Record<string, string>

export interface CouncillorData {
  name: string
  slug: string
  meetings: Meeting[]
  count: number
  committees: { name: string; slug: string }[]
  yearsActive: number[]
}

export interface Meeting {
  title: string
  date: string
  slug: string
  year: number
  month: number
  committee: string
  committeeSlug: string
  councillors: string[]
  filePath: string
}
