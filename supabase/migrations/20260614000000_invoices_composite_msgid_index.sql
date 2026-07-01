-- Allow a credit note (ingested as a negative invoice) and its original invoice
-- to share one gmail_message_id. The old single-column unique index permitted
-- only ONE invoice per email; replace it with a composite that mirrors the
-- ingest dedup key (gmail_message_id + invoice_number + supplier_id), so the
-- same email may hold multiple invoices when their numbers differ (the
-- credit-note number differs from the original invoice number).
--
-- Safe: confirmed zero existing invoices share a gmail_message_id.
--
-- Partial predicate excludes numberless ('' / NULL) and supplier-less rows.
-- Numberless docs carry invoice_number = '' (invoices-ingest:1122) and are
-- deduped by the application via (gmail_message_id, storage_url), NOT by this
-- constraint (see handleInvoiceFile :1529-1534). Including them here would
-- wrongly collide multiple numberless docs in one email. The predicate matches
-- the app's numbered-dedup branch exactly: `if (supplierId && invoice_number)`.

DROP INDEX IF EXISTS invoices_gmail_message_id_uidx;

CREATE UNIQUE INDEX IF NOT EXISTS invoices_msg_invnum_supplier_uidx
  ON invoices (gmail_message_id, invoice_number, supplier_id)
  WHERE gmail_message_id IS NOT NULL
    AND invoice_number IS NOT NULL
    AND invoice_number <> ''
    AND supplier_id IS NOT NULL;
