# Bulk import fixtures and results

Instead of adding matches one at a time, you can upload a spreadsheet of a whole season's fixtures — and their results — in one go. It's on a competition's **Matches** tab, under the **Import** button.

## How it works

1. Open your competition, go to the **Matches** tab, and click **Import**.
2. Click **Download template** to get the spreadsheet layout, and fill in your fixtures.
3. Click **Upload spreadsheet** and choose your filled-in file.
4. MatchPulse **matches every row** to existing organisations and teams and shows you a preview — each row marked ready ✓ or "can't import" with the reason.
5. Review it, then click **Import**. Only the ready rows are created; anything that couldn't be matched is listed and skipped, and a report of it is saved.

Nothing is created until you click Import, so the preview is always safe to look at.

## The template columns

- **Date** *(required)* — the match date, e.g. `2026-05-09`.
- **Time** — kick-off in 24-hour format, e.g. `10:00`. Leave blank for "time to be confirmed".
- **Home Organisation** *(required)* — the home club/school name, exactly as on MatchPulse.
- **Home Team** *(required)* — the home team, e.g. `U14A`.
- **Away Organisation** *(required)* — the away club/school name.
- **Away Team** *(required)* — the away team.
- **Home Score** — the home team's score (only for a played result).
- **Away Score** — the away team's score (only for a played result).
- **Venue** — where it's played (optional).
- **Pool** — for a tournament with pools, the pool name (optional).

## Fixtures vs results

- **Leave both score columns blank** → the row imports as an **upcoming fixture**.
- **Fill in both scores** → the row imports as a **completed result** (final).
- Filling in only one score is treated as a mistake and the row is skipped.

## Matching is exact — nothing is guessed

Organisation and team names must match what's on MatchPulse **exactly** (spacing and spelling; capitalisation doesn't matter). If a row's organisation or team can't be found, or the name matches more than one team, that row is **not imported** — it's never guessed at. You'll see exactly why in the preview and in the saved report, so you can fix the name and re-import just those rows.

A team that exists on MatchPulse but isn't yet in this competition is **added to it automatically** when you import its match.

## What isn't imported

After importing, any skipped rows are shown with the reason, and you can **download the not-imported rows** as a spreadsheet to correct and upload again. A report of every import (what went in, what was skipped and why) is saved to the competition for your records.

If a whole file won't read, make sure it's an `.xlsx` saved from the template. See also [Add a match](add-a-match.md) and [Generate matches](generate-matches.md).
