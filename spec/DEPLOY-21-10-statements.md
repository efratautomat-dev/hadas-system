# פריסה — התאמת כרטסת: טווח, וי, הדפסה (21.10.2026)

ענף: **`feat/statement-marks`**. מ-PowerShell, מתוך `hadas-deploy`.
פריסה קטנה: מיגרציה אחת ופונקציה אחת.

## א · הקוד
```powershell
cd $HOME\Desktop\hadas-deploy
git fetch origin
git checkout feat/statement-marks
git pull
git log --oneline -1
```
✔ השורה מתחילה ב-`feat(statements): …`

## ב · מסד הנתונים
```powershell
supabase db push --dry-run
```
✔ צריכה להופיע **רק** `20261021010000_statement_reconcile_marks.sql`. אחרת — לעצור ולשלוח.
```powershell
supabase db push
```

## ג · פונקציה אחת
```powershell
supabase functions deploy hadas-api --project-ref jcwphkuwwuxvjibmvgdh
```
(`invoices-ingest` ו-`backup-run` לא השתנו.)

## ד · מיזוג
https://github.com/efratautomat-dev/hadas-system/compare/main...feat/statement-marks
→ Create pull request → Merge. לכתוב "מוזג" — אני בודק שורסל באמת עלה ומעדכן את ההדגמה.

## בדיקות
`spec/TESTS-18-10.md` → "התאמת כרטסת — טווח, וי, הדפסה" (מחשב) ו"התאמת כרטסת" (טאבלט).
