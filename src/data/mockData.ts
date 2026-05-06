export const mockStats = {
  activeSuppliers: 47,
  pendingInvoices: 12,
  monthlyPayments: 128500,
  openReturns: 3,
}

export interface Invoice {
  id: string
  invoiceDate: string
  supplierId: string
  supplier: string
  category: string
  isPartialReturn: boolean
  lineDetails: string
  amountBeforeVat: number
  vat: number
  amount: number
  senderName: string
  senderEmail: string
  driveFileLink: string
  monthFolderLink: string
  originalEmailLink: string
  emailReceivedAt: string
  emailId: string
  uploadDate: string
  status: string
  isDuplicate: boolean
  hasError: boolean
  n8nErrorLink: string
  decodeQuality: string
  sentToAccountant: boolean
  date: string
}

export const mockInvoices: Invoice[] = [
  {
    id: 'INV-2026-001', supplier: 'תבורי בע"מ', supplierId: 'SUP-002',
    date: '01/05/2026', invoiceDate: '2026-05-01',
    amount: 12500, amountBeforeVat: 10684, vat: 1816,
    status: 'ממתין', category: 'ספקים ביגוד',
    isPartialReturn: false, lineDetails: '',
    senderName: 'רחל לוי', senderEmail: 'rachel@tavorim.co.il',
    driveFileLink: '', monthFolderLink: '', originalEmailLink: '',
    emailReceivedAt: '2026-05-01T09:00', emailId: 'MSG-001', uploadDate: '2026-05-01',
    isDuplicate: false, hasError: false, n8nErrorLink: '', decodeQuality: 'גבוהה', sentToAccountant: false,
  },
  {
    id: 'INV-2026-002', supplier: 'מקורות מים', supplierId: 'SUP-006',
    date: '28/04/2026', invoiceDate: '2026-04-28',
    amount: 8300, amountBeforeVat: 7094, vat: 1206,
    status: 'הושלם', category: 'הוצאות ניהול',
    isPartialReturn: false, lineDetails: '',
    senderName: 'אסתר מזרחי', senderEmail: 'esther@makorot.co.il',
    driveFileLink: '', monthFolderLink: '', originalEmailLink: '',
    emailReceivedAt: '2026-04-28T11:30', emailId: 'MSG-002', uploadDate: '2026-04-28',
    isDuplicate: false, hasError: false, n8nErrorLink: '', decodeQuality: 'גבוהה', sentToAccountant: true,
  },
  {
    id: 'INV-2026-003', supplier: 'תנובה', supplierId: 'SUP-001',
    date: '25/04/2026', invoiceDate: '2026-04-25',
    amount: 45200, amountBeforeVat: 38632, vat: 6568,
    status: 'ממתין', category: 'ספקים כיסויי ראש',
    isPartialReturn: false, lineDetails: 'כיסויי ראש קיץ - 120 יח׳\nמטפחות - 60 יח׳',
    senderName: 'משה כהן', senderEmail: 'moshe@tnuva.co.il',
    driveFileLink: '', monthFolderLink: '', originalEmailLink: '',
    emailReceivedAt: '2026-04-25T08:15', emailId: 'MSG-003', uploadDate: '2026-04-25',
    isDuplicate: false, hasError: false, n8nErrorLink: '', decodeQuality: 'בינונית', sentToAccountant: false,
  },
  {
    id: 'INV-2026-004', supplier: 'אסם השקעות', supplierId: 'SUP-003',
    date: '20/04/2026', invoiceDate: '2026-04-20',
    amount: 6800, amountBeforeVat: 5812, vat: 988,
    status: 'בטיפול', category: 'הוצאות משרד',
    isPartialReturn: true, lineDetails: '',
    senderName: 'יוסף אברהם', senderEmail: 'yosef@osem.co.il',
    driveFileLink: '', monthFolderLink: '', originalEmailLink: '',
    emailReceivedAt: '2026-04-20T14:00', emailId: 'MSG-004', uploadDate: '2026-04-20',
    isDuplicate: false, hasError: true, n8nErrorLink: '', decodeQuality: 'נמוכה', sentToAccountant: false,
  },
  {
    id: 'INV-2026-005', supplier: 'עלית', supplierId: 'SUP-004',
    date: '18/04/2026', invoiceDate: '2026-04-18',
    amount: 3200, amountBeforeVat: 2735, vat: 465,
    status: 'הושלם', category: 'שונות',
    isPartialReturn: false, lineDetails: '',
    senderName: 'שרה גרין', senderEmail: 'sarah@elite.co.il',
    driveFileLink: '', monthFolderLink: '', originalEmailLink: '',
    emailReceivedAt: '2026-04-18T10:45', emailId: 'MSG-005', uploadDate: '2026-04-18',
    isDuplicate: false, hasError: false, n8nErrorLink: '', decodeQuality: 'גבוהה', sentToAccountant: true,
  },
  {
    id: 'INV-2026-006', supplier: 'נסטלה ישראל', supplierId: 'SUP-005',
    date: '15/04/2026', invoiceDate: '2026-04-15',
    amount: 23100, amountBeforeVat: 19744, vat: 3356,
    status: 'הושלם', category: 'ספקים בגדי ים',
    isPartialReturn: false, lineDetails: '',
    senderName: 'דוד רוזן', senderEmail: 'david@nestle.co.il',
    driveFileLink: '', monthFolderLink: '', originalEmailLink: '',
    emailReceivedAt: '2026-04-15T09:30', emailId: 'MSG-006', uploadDate: '2026-04-15',
    isDuplicate: false, hasError: false, n8nErrorLink: '', decodeQuality: 'גבוהה', sentToAccountant: true,
  },
  {
    id: 'INV-2026-007', supplier: 'שטראוס גרופ', supplierId: 'SUP-007',
    date: '10/04/2026', invoiceDate: '2026-04-10',
    amount: 9750, amountBeforeVat: 8333, vat: 1417,
    status: 'ממתין', category: 'ספקים ביגוד',
    isPartialReturn: false, lineDetails: '',
    senderName: 'נתן שפירא', senderEmail: 'natan@strauss.co.il',
    driveFileLink: '', monthFolderLink: '', originalEmailLink: '',
    emailReceivedAt: '2026-04-10T13:00', emailId: 'MSG-007', uploadDate: '2026-04-10',
    isDuplicate: false, hasError: false, n8nErrorLink: '', decodeQuality: 'בינונית', sentToAccountant: false,
  },
  {
    id: 'INV-2026-008', supplier: 'תנובה', supplierId: 'SUP-001',
    date: '05/04/2026', invoiceDate: '2026-04-05',
    amount: 18400, amountBeforeVat: 15726, vat: 2674,
    status: 'הושלם', category: 'ספקים שונות',
    isPartialReturn: false, lineDetails: '',
    senderName: 'משה כהן', senderEmail: 'moshe@tnuva.co.il',
    driveFileLink: '', monthFolderLink: '', originalEmailLink: '',
    emailReceivedAt: '2026-04-05T11:00', emailId: 'MSG-008', uploadDate: '2026-04-05',
    isDuplicate: false, hasError: false, n8nErrorLink: '', decodeQuality: 'גבוהה', sentToAccountant: true,
  },
  {
    id: 'INV-2026-009', supplier: 'אסם השקעות', supplierId: 'SUP-003',
    date: '01/04/2026', invoiceDate: '2026-04-01',
    amount: 4200, amountBeforeVat: 3590, vat: 610,
    status: 'בטיפול', category: 'הוצאות משרד',
    isPartialReturn: false, lineDetails: '',
    senderName: 'יוסף אברהם', senderEmail: 'yosef@osem.co.il',
    driveFileLink: '', monthFolderLink: '', originalEmailLink: '',
    emailReceivedAt: '2026-04-01T09:00', emailId: 'MSG-009', uploadDate: '2026-04-01',
    isDuplicate: true, hasError: false, n8nErrorLink: '', decodeQuality: 'נמוכה', sentToAccountant: false,
  },
  {
    id: 'INV-2026-010', supplier: 'תבורי בע"מ', supplierId: 'SUP-002',
    date: '28/03/2026', invoiceDate: '2026-03-28',
    amount: 7600, amountBeforeVat: 6496, vat: 1104,
    status: 'הושלם', category: 'שונות',
    isPartialReturn: false, lineDetails: '',
    senderName: 'רחל לוי', senderEmail: 'rachel@tavorim.co.il',
    driveFileLink: '', monthFolderLink: '', originalEmailLink: '',
    emailReceivedAt: '2026-03-28T10:00', emailId: 'MSG-010', uploadDate: '2026-03-28',
    isDuplicate: false, hasError: false, n8nErrorLink: '', decodeQuality: 'גבוהה', sentToAccountant: true,
  },
]

export const mockPayments = [
  { id: 'PAY-001', supplier: 'תנובה', amount: 45200, dueDate: '10/05/2026', method: 'העברה בנקאית' },
  { id: 'PAY-002', supplier: 'תבורי בע"מ', amount: 12500, dueDate: '15/05/2026', method: 'שיק' },
  { id: 'PAY-003', supplier: 'נסטלה ישראל', amount: 23100, dueDate: '20/05/2026', method: 'העברה בנקאית' },
]

export const mockDeliveries = [
  { id: 'DEL-001', supplier: 'מקורות מים', items: 24, date: '02/05/2026', status: 'נתקבל' },
  { id: 'DEL-002', supplier: 'אסם השקעות', items: 12, date: '01/05/2026', status: 'בדרך' },
  { id: 'DEL-003', supplier: 'עלית', items: 36, date: '30/04/2026', status: 'נתקבל' },
  { id: 'DEL-004', supplier: 'שטראוס גרופ', items: 8, date: '29/04/2026', status: 'נתקבל' },
]

export const mockSuppliers = [
  { id: 'SUP-001', name: 'תנובה', category: 'מוצרי חלב', contact: 'משה כהן', phone: '03-5551234', status: 'פעיל', paymentTerms: 'שוטף+30', lastOrderDate: '01/05/2026', balance: 45200 },
  { id: 'SUP-002', name: 'תבורי בע"מ', category: 'משקאות', contact: 'רחל לוי', phone: '04-9876543', status: 'פעיל', paymentTerms: 'שוטף+60', lastOrderDate: '28/04/2026', balance: 12500 },
  { id: 'SUP-003', name: 'אסם השקעות', category: 'מזון יבש', contact: 'יוסף אברהם', phone: '03-1234567', status: 'פעיל', paymentTerms: 'שוטף+45', lastOrderDate: '20/04/2026', balance: 6800 },
  { id: 'SUP-004', name: 'עלית', category: 'ממתקים', contact: 'שרה גרין', phone: '09-4441111', status: 'פעיל', paymentTerms: 'שוטף+30', lastOrderDate: '18/04/2026', balance: 3200 },
  { id: 'SUP-005', name: 'נסטלה ישראל', category: 'שתייה חמה', contact: 'דוד רוזן', phone: '03-7778899', status: 'פעיל', paymentTerms: 'שוטף+30', lastOrderDate: '15/04/2026', balance: 23100 },
  { id: 'SUP-006', name: 'מקורות מים', category: 'משקאות', contact: 'אסתר מזרחי', phone: '08-6665544', status: 'פעיל', paymentTerms: 'שוטף+60', lastOrderDate: '10/04/2026', balance: 8300 },
  { id: 'SUP-007', name: 'שטראוס גרופ', category: 'מוצרי חלב', contact: 'נתן שפירא', phone: '03-9990001', status: 'פעיל', paymentTerms: 'שוטף+45', lastOrderDate: '05/04/2026', balance: 18700 },
  { id: 'SUP-008', name: 'אנגל בייקרס', category: 'מאפים', contact: 'מרים כץ', phone: '02-5553332', status: 'לא פעיל', paymentTerms: 'שוטף+30', lastOrderDate: '15/02/2026', balance: 0 },
]
