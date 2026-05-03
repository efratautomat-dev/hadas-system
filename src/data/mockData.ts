export const mockStats = {
  activeSuppliers: 47,
  pendingInvoices: 12,
  monthlyPayments: 128500,
  openReturns: 3,
}

export const mockInvoices = [
  { id: 'INV-2026-001', supplier: 'תבורי בע"מ',    amount: 12500, date: '01/05/2026', status: 'ממתין' },
  { id: 'INV-2026-002', supplier: 'מקורות מים',    amount:  8300, date: '28/04/2026', status: 'שולם'  },
  { id: 'INV-2026-003', supplier: 'תנובה',          amount: 45200, date: '25/04/2026', status: 'ממתין' },
  { id: 'INV-2026-004', supplier: 'אסם השקעות',    amount:  6800, date: '20/04/2026', status: 'בטיפול'},
  { id: 'INV-2026-005', supplier: 'עלית',           amount:  3200, date: '18/04/2026', status: 'שולם'  },
  { id: 'INV-2026-006', supplier: 'נסטלה ישראל',   amount: 23100, date: '15/04/2026', status: 'שולם'  },
  { id: 'INV-2026-007', supplier: 'שטראוס גרופ',   amount:  9750, date: '10/04/2026', status: 'ממתין' },
  { id: 'INV-2026-008', supplier: 'תנובה',          amount: 18400, date: '05/04/2026', status: 'שולם'  },
  { id: 'INV-2026-009', supplier: 'אסם השקעות',    amount:  4200, date: '01/04/2026', status: 'בטיפול'},
  { id: 'INV-2026-010', supplier: 'תבורי בע"מ',    amount:  7600, date: '28/03/2026', status: 'שולם'  },
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
