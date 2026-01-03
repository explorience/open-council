/**
 * Audit data coverage - identify gaps and anomalies in meeting data
 *
 * Handles edge cases like council term transitions where fewer meetings
 * are expected (e.g., November/December of election years).
 */

import { readdir } from 'fs/promises';
import { join } from 'path';

const DATA_DIR = join(process.cwd(), 'data');

// Council term transition periods - fewer meetings expected
// Elections happen in October, new council inaugurated in November
const COUNCIL_TRANSITIONS = [
  { year: 2010, months: [11, 12] },  // 2010-2014 term start
  { year: 2014, months: [11, 12] },  // 2014-2018 term start
  { year: 2018, months: [11, 12] },  // 2018-2022 term start
  { year: 2022, months: [11, 12] },  // 2022-2026 term start
];

// Summer months typically have fewer meetings
const LOW_ACTIVITY_MONTHS = [7, 8]; // July, August

interface MonthStats {
  month: string;
  meetingCount: number;
}

interface YearStats {
  year: number;
  totalMeetings: number;
  months: MonthStats[];
  issues: string[];
}

function isTransitionPeriod(year: number, month: number): boolean {
  return COUNCIL_TRANSITIONS.some(t => t.year === year && t.months.includes(month));
}

function isLowActivityMonth(month: number): boolean {
  return LOW_ACTIVITY_MONTHS.includes(month);
}

async function auditDataCoverage(): Promise<void> {
  console.log('=== Data Coverage Audit ===\n');

  // Get all month directories
  const entries = await readdir(DATA_DIR);
  const monthDirs = entries.filter(e => /^\d{4}-\d{2}$/.test(e)).sort();

  // Group by year
  const yearData: Map<number, MonthStats[]> = new Map();

  for (const monthDir of monthDirs) {
    const [yearStr] = monthDir.split('-');
    const year = parseInt(yearStr);

    // Get JSON files in this month
    const monthPath = join(DATA_DIR, monthDir);
    const files = await readdir(monthPath);
    const jsonFiles = files.filter(f => f.endsWith('.json'));

    if (!yearData.has(year)) {
      yearData.set(year, []);
    }
    yearData.get(year)!.push({
      month: monthDir,
      meetingCount: jsonFiles.length,
    });
  }

  // Analyze each year
  const allYears: YearStats[] = [];
  const firstYear = Math.min(...yearData.keys());
  const lastYear = Math.max(...yearData.keys());

  for (const [year, months] of yearData) {
    const stats: YearStats = {
      year,
      totalMeetings: months.reduce((sum, m) => sum + m.meetingCount, 0),
      months,
      issues: [],
    };

    // Check for issues (skip partial first/last years)
    if (year > firstYear && year < lastYear) {
      for (let m = 1; m <= 12; m++) {
        const monthStr = year + '-' + String(m).padStart(2, '0');
        const monthData = months.find(md => md.month === monthStr);

        if (!monthData) {
          stats.issues.push(`Missing month: ${monthStr}`);
        } else if (monthData.meetingCount === 0) {
          stats.issues.push(`Empty month: ${monthStr}`);
        } else if (monthData.meetingCount < 5) {
          // Check if this is expected to be low
          if (isTransitionPeriod(year, m)) {
            // Expected - council transition period
            continue;
          } else if (isLowActivityMonth(m)) {
            // Expected - summer months
            continue;
          } else {
            stats.issues.push(`Low count (${monthData.meetingCount}): ${monthStr}`);
          }
        }
      }
    }

    allYears.push(stats);
  }

  // Print summary
  console.log('Year-by-Year Summary:\n');
  console.log('Year\tMeetings\tStatus');
  console.log('----\t--------\t------');

  for (const ys of allYears) {
    const status = ys.issues.length > 0 ? `${ys.issues.length} issue(s)` : '✓ OK';
    console.log(`${ys.year}\t${ys.totalMeetings}\t\t${status}`);
  }

  // Print detailed issues
  const yearsWithIssues = allYears.filter(y => y.issues.length > 0);
  if (yearsWithIssues.length > 0) {
    console.log('\n\nIssues Found:\n');
    for (const ys of yearsWithIssues) {
      console.log(`${ys.year}:`);
      for (const issue of ys.issues) {
        console.log(`  - ${issue}`);
      }
    }
  } else {
    console.log('\n\n✓ No issues found!\n');
  }

  // Print council transition info
  console.log('\nNote: Council term transitions (Nov/Dec of election years) are');
  console.log('expected to have fewer meetings and are not flagged as issues.');
  console.log('Transition years: 2010, 2014, 2018, 2022\n');

  // Print recent months breakdown
  console.log('\nRecent Months (2024-2025):\n');
  for (const ys of allYears.filter(y => y.year >= 2024)) {
    console.log(`${ys.year}:`);
    for (const m of ys.months) {
      const [, monthNum] = m.month.split('-');
      const monthName = new Date(2000, parseInt(monthNum) - 1).toLocaleString('en', { month: 'short' });
      console.log(`  ${monthName}: ${m.meetingCount} meetings`);
    }
    console.log('');
  }

  // Total statistics
  const totalMeetings = allYears.reduce((sum, y) => sum + y.totalMeetings, 0);
  const totalIssues = allYears.reduce((sum, y) => sum + y.issues.length, 0);

  console.log('=== Summary ===');
  console.log(`Total meetings: ${totalMeetings}`);
  console.log(`Total issues: ${totalIssues}`);
  console.log(`Date range: ${monthDirs[0]} to ${monthDirs[monthDirs.length - 1]}`);
}

auditDataCoverage().catch(console.error);
