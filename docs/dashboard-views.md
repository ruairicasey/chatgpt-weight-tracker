# Dashboard: day, week and month views

Read-only owner dashboard at `/dashboard`. No migration and no new environment variables.

## URLs
- `/dashboard?view=day&date=YYYY-MM-DD` (default view; default date is today in Melbourne)
- `/dashboard?view=week&date=…`: Monday–Sunday week containing the date
- `/dashboard?view=month&date=…`: calendar month, laid out as a Monday-aligned grid
- `history=all` on the day view shows every weigh-in (otherwise the latest 14)

## Day status colours (week and month cards)
| Status | Rule |
|---|---|
| On target (green) | food logged and calories ≤ target |
| Slightly over (amber) | calories ≤ target + 100 kcal (`CLOSE_BAND_KCAL`) |
| Over (red) | calories > target + 100 kcal |
| Not logged (grey) | no food entries that day |
| Upcoming (faded) | after today (Melbourne) |

The target for a day is the latest `daily_targets` row with `effective_from` ≤ that day.
Protein is "hit" when protein ≥ the day's protein target.

## Period stats
Computed over in-month/in-week days up to today. Days without food are excluded from
averages. Total deficit = Σ(target − calories) over logged days with a target (negative
is shown as a surplus). Weight change = last minus first weigh-in inside the period.
Exercise calories are informational only and never change targets or deficits.

## Other changes
- Prev/next arrows and a Today link for each view, plus a date picker.
- Progress bars for calories and protein on the day view.
- Trend chart hidden until there are two weigh-ins; min/max weight and date labels added.
- Sign out: `POST /logout`, same-origin only (`requireSameOrigin`), clears this browser's
  session. GET is not supported.

All reads use the owner's cookie session with the publishable key, so RLS remains the
authorization boundary.
