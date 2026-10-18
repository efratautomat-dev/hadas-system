# פריסה — גיבוי שבועי + שלב 1 (18.10.2026)

ענף: **`fix/phase2-daily`** (כולל בתוכו את הגיבוי, שלב 1 ושלב 2-א). הכל רץ **מהמחשב שלך**,
ב-**PowerShell**, מתוך התיקייה `C:\Users\<user>\Desktop\hadas-deploy`.
הפרודקשן: `jcwphkuwwuxvjibmvgdh`.

> כל שלב — להריץ, לראות שעבר, ורק אז לעבור לבא. אם משהו נכשל: לעצור, להעתיק את
> ההודעה ולשלוח.

---

## שלב א · להביא את הקוד

```powershell
cd C:\Users\<user>\Desktop\hadas-deploy
git fetch origin
git checkout fix/phase2-daily
git pull
```
✔ בסוף: `git log --oneline -1` מראה `fix: the email opens where it is…` (או חדש ממנו)

## שלב ב · מסד הנתונים (טבלת היסטוריית הגיבויים)

```powershell
supabase db push --dry-run
```
✔ צריכה להופיע **רק** `20261007000000_backup_runs.sql`. אם מופיעה עוד מיגרציה — לעצור ולשלוח לי.

```powershell
supabase db push
```
(אם הוא מסרב ומבקש `--include-all` — להריץ `supabase db push --include-all`. קרה בעבר.)

## שלב ג · שלוש הפונקציות — כולן, ובסדר הזה

```powershell
supabase functions deploy backup-run      --project-ref jcwphkuwwuxvjibmvgdh
supabase functions deploy hadas-api       --project-ref jcwphkuwwuxvjibmvgdh
supabase functions deploy invoices-ingest --project-ref jcwphkuwwuxvjibmvgdh
```
⚠️ **אסור לעצור באמצע.** קוד הדרייב עבר למקום משותף; אם רק חלק נפרס — קליטת
מיילים או מחיקת חשבונית יישברו. לא צריך להגדיר סודות חדשים: הגיבוי משתמש באותם
מפתחות של ג'ימייל/דרייב שכבר מוגדרים.

## שלב ד · המסך (ורסל)

ב-GitHub: לפתוח Pull Request מ-`fix/phase2-daily` אל `main` ולמזג, כרגיל.
הקישור: https://github.com/efratautomat-dev/hadas-system/compare/main...fix/phase2-daily

ההדגמה (`incontrol.ctrlplusf.com`) מתעדכנת מהשרת — תכתבי לי "מוזג" ואני מריץ אותה.

## שלב ה · גיבוי ראשון ידני

1. במערכת: **הגדרות → גיבוי → "גיבוי עכשיו"**. לחכות דקה-שתיים.
2. בדרייב, בתיקייה הראשית של המערכת, תיווצר:
   ```
   גיבויים / 2026 / אוקטובר / גיבוי 2026-10-18 /
   ```
   ובתוכה: קובץ JSON לכל טבלה, קובץ אקסל **`גיבוי 2026-10-18.xlsx`** לקריאה,
   ו-`_manifest.json` — **הקובץ האחרון שנכתב; אם הוא שם, הגיבוי שלם.**
3. לפתוח את האקסל ולוודא שיש בו חשבוניות וספקים.

## שלב ו · להפעיל גיבוי אוטומטי כל לילה בין ראשון לשני — רק אחרי שה' עבד

ב-Supabase → **SQL Editor** → להדביק את כל התוכן של הקובץ
`supabase/SCHEDULE-DB-BACKUP.sql` → **Run**.
✔ חוזר מספר אחד (מספר המשימה). מעכשיו: כל לילה שבין ראשון לשני, 03:00–04:00 לפי שעון ישראל. (תיקיית הגיבוי תישא את התאריך של יום שני.)

---

## שאילתות לבירור "הכל-בו בלומנטל" (סעיף 11)

להריץ ב-**SQL Editor**, אחת-אחת, ולשלוח לי את התוצאות (צילום מסך מספיק).
אפשר להריץ **כבר עכשיו**, לפני הפריסה — הן רק קוראות.

**1 · לאן נותב כל מייל**
```sql
select l.message_id, l.timestamp, l.message
from system_logs l
where l.message_id in (
  select message_id from system_logs
  where message = 'processing' and context->>'subject' ilike '%DocumentCopyCentral%')
order by l.message_id, l.timestamp;
```

**2 · האם נוצרו כרטסות מהשולח הזה**
```sql
select * from vendor_statements
where email_sender ilike '%' || (
  select context->>'from' from system_logs
  where message = 'processing' and context->>'subject' ilike '%DocumentCopyCentral%'
  limit 1) || '%';
```

**3 · האם נוצרו התראות**
```sql
select * from alerts where payload->>'subject' ilike '%DocumentCopyCentral%';
```

אם שאילתה 1 ריקה — להחליף בה את `DocumentCopyCentral` ב-`בלומנטל` ולהריץ שוב.
