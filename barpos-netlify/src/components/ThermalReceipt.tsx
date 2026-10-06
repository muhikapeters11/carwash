import type { Sale } from "@/types";
import type { AppSettings } from "@/types";
import { formatMoney } from "@/lib/utils";

interface Props {
  sale: Sale;
  settings: AppSettings;
  onClose: () => void;
  title?: string;
  autoPrint?: boolean;
}

/**
 * Receipt preview + print.
 * Important: receipt body must NOT sit under a parent with display:none in print,
 * or the page prints blank.
 */
export function ThermalReceipt({ sale, settings, onClose, title }: Props) {
  const width = settings.thermal_width_mm === 58 ? 58 : 80;

  const doPrint = () => {
    const prev = document.title;
    document.title = " ";
    const close = () => {
      document.title = prev;
      onClose();
    };
    window.addEventListener("afterprint", close, { once: true });
    // Small delay so layout paints before print preview
    requestAnimationFrame(() => {
      window.print();
    });
    setTimeout(close, 2500);
  };

  return (
    <>
      <style>{`
        @media print {
          @page { margin: 0; size: ${width}mm auto; }
          html, body {
            margin: 0 !important;
            padding: 0 !important;
            background: #fff !important;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          .receipt-screen-only { display: none !important; }
          .thermal-print-root {
            display: block !important;
            visibility: visible !important;
            position: fixed !important;
            left: 0 !important;
            top: 0 !important;
            width: ${width}mm !important;
            max-width: ${width}mm !important;
            margin: 0 !important;
            padding: 3mm !important;
            background: #fff !important;
            color: #000 !important;
            z-index: 99999 !important;
          }
          .thermal-print-root * {
            visibility: visible !important;
            color: #000 !important;
          }
        }
      `}</style>

      {/* Screen overlay (hidden when printing) */}
      <div className="receipt-screen-only fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
        <div className="bg-white text-black rounded-2xl w-full max-w-sm overflow-hidden shadow-2xl">
          <div className="px-5 py-3 border-b flex justify-between items-center">
            <h2 className="font-bold text-slate-900">{title || "Receipt"}</h2>
          </div>

          {/* Preview copy on screen */}
          <div
            className="font-mono text-black bg-white mx-auto px-3 py-4"
            style={{
              width: `${width}mm`,
              maxWidth: "100%",
              fontSize: width === 58 ? "11px" : "13px",
              lineHeight: 1.3,
            }}
          >
            <ReceiptBody sale={sale} settings={settings} />
          </div>

          <div className="px-5 pb-5 flex gap-2">
            <button
              type="button"
              onClick={doPrint}
              className="flex-1 py-3 rounded-xl bg-slate-900 text-white font-bold"
            >
              Print
            </button>
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-3 rounded-xl border-2 border-slate-300 font-semibold text-slate-800"
            >
              Done
            </button>
          </div>
        </div>
      </div>

      {/* Dedicated print-only tree (not under display:none parent) */}
      <div
        className="thermal-print-root font-mono"
        style={{
          position: "absolute",
          left: "-9999px",
          top: 0,
          width: `${width}mm`,
          fontSize: width === 58 ? "11px" : "13px",
          lineHeight: 1.3,
          color: "#000",
          background: "#fff",
        }}
        aria-hidden
      >
        <ReceiptBody sale={sale} settings={settings} />
      </div>
    </>
  );
}

function ReceiptBody({
  sale,
  settings,
}: {
  sale: Sale;
  settings: AppSettings;
}) {
  return (
    <>
      <div className="text-center font-bold text-base leading-tight">
        {settings.business_name || "Bar"}
      </div>
      {settings.business_location ? (
        <div className="text-center text-[10px] leading-tight">
          {settings.business_location}
        </div>
      ) : null}
      {settings.till_number ? (
        <div className="text-center text-sm font-bold italic leading-tight">
          Till No: {settings.till_number}
        </div>
      ) : null}
      <div className="text-center text-[10px] mt-1">
        {new Date(sale.created_at).toLocaleString()}
      </div>
      <div className="text-center text-[10px]">Served by: {sale.cashier_name}</div>
      {sale.sale_number ? (
        <div className="text-center font-bold text-sm mt-1 tracking-wide">
          Order: {sale.sale_number}
        </div>
      ) : null}

      <div className="border-t border-dashed border-black my-1.5" />

      {sale.items.length > 0 ? (
        sale.items.map((i) => (
          <div key={i.id} className="flex justify-between gap-1 text-[11px]">
            <span className="truncate pr-1">
              {i.quantity}× {i.product_name}
            </span>
            <span className="whitespace-nowrap shrink-0">
              {formatMoney(i.line_total)}
            </span>
          </div>
        ))
      ) : (
        <div className="text-center text-[11px]">
          {sale.is_credit_payment ? "Credit payment" : "Sale"}
        </div>
      )}

      <div className="border-t border-dashed border-black my-1.5" />
      <div className="flex justify-between font-bold text-[12px]">
        <span>TOTAL</span>
        <span>{formatMoney(sale.total)}</span>
      </div>
      <div className="flex justify-between capitalize text-[11px] mt-0.5">
        <span>{sale.payment_method}</span>
        <span>
          {sale.payment_method === "credit"
            ? sale.credit_customer_name
            : formatMoney(sale.amount_paid)}
        </span>
      </div>
      {sale.change_given > 0 && (
        <div className="flex justify-between text-[11px] mt-0.5">
          <span>Change</span>
          <span>{formatMoney(sale.change_given)}</span>
        </div>
      )}
      <div className="text-center mt-6 pt-1 text-[10px]">
        {settings.receipt_footer || "Thank you for your business!"}
      </div>
    </>
  );
}
