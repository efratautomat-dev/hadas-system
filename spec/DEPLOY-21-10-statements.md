# פריסה — כרטסות: התאמה עם ✓ קבוע, כרטיס ספק בלשוניות, הדפסה (21.10.2026)

ענף: **`feat/statement-marks`**. מ-PowerShell, מתוך `hadas-deploy`.
מיגרציה אחת, שתי פונקציות.

## א · הקוד
```powershell
cd $HOME\Desktop\hadas-deploy
git fetch origin
git checkout feat/statement-marks
git pull
git log --oneline -1
```
✔ השורה מתחילה ב-`feat(ledger): …` (או חדש ממנו)

## ב · מסד הנתונים
```powershell
supabase db push --dry-run
```
✔ צריכה להופיע **רק** `20261021010000_ledger_marks.sql`. אחרת — לעצור ולשלוח.
```powershell
supabase db push
```

## ג · שתי פונקציות, שתיהן
```powershell
supabase functions deploy hadas-api  --project-ref jcwphkuwwuxvjibmvgdh
supabase functions deploy backup-run --project-ref jcwphkuwwuxvjibmvgdh
```
(`backup-run` — כי הטבלה החדשה נכנסה לרשימת הגיבוי. בלי זה הגיבוי הבא יתריע
"טבלה חדשה אינה מגובה".)

## ד · מיזוג
https://github.com/efratautomat-dev/hadas-system/compare/main...feat/statement-marks
→ Create pull request → Merge. לכתוב "מוזג" — אני בודק שורסל באמת עלה ומעדכן את ההדגמה.

## בדיקות
`spec/TESTS-21-10.md` → סעיפים 3 ו-8 (מחשב), D ו-E (טאבלט) — המסומנים 🟡.
