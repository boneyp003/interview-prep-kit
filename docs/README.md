# Sample output

`sample-kit.json` is a real, unedited `npm run evaluate` result for:

```json
{ "id": "posthog-be",
  "jd": "Senior Backend Engineer … 5+ years Python/Go, PostgreSQL, event-driven
         systems, designed for scale, mentor engineers. Bonus: ClickHouse,
         open-source.",
  "company_url": "https://posthog.com/",
  "days": 7 }
```

It shows the pipeline finding PostHog's hiring process at deeply-nested handbook
URLs (`/handbook/people/hiring-process/engineering-hiring`), a grounded company
brief, 14 questions across 3 categories with stable requirement references, a
balanced 7-day schedule, and `coverage.uncovered_requirement_ids: []` after one
pass. Model: `gemini-flash-lite-latest`. Wall time: ~26 s.
