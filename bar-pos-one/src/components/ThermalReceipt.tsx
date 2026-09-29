import type { Sale } from "@/types";
import type { AppSettings } from "@/types";
import { formatMoney } from "@/lib/utils";

interface Props {
  sale: Sale;
  settings: AppSettings;
  onClose: () => void;
  title?: string;
}

/** 58mm / 80mm thermal-friendly receipt preview + print */
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
    window.print();
    setTimeout(close, 800);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 print:bg-white print:p-0">
      <div className="bg-white text-black rounded-2xl w-full max-w-sm overflow-hidden shadow-2xl print:shadow-none print:rounded-none">
        <div className="px-5 py-3 border-b flex justify-between items-center print:hidden">
          <h2 className="font-bold text-slate-900">{title || "Receipt"}</h2>
          <span className="text-xs text-slate-500">{width}mm</span>
        </div>

        <div
          className="thermal-receipt px-3 pt-4 pb-6 font-mono text-black bg-white mx-auto"
          style={{
            width: `${width}mm`,
            maxWidth: "100%",
            fontSize: width === 58 ? "11px" : "13px",
            lineHeight: 1.35,
          }}
        >
          <div className="text-center font-bold text-base mb-1">
            {settings.business_name || "Bar"}
          </div>
          {settings.business_location ? (
            <div className="text-center text-[10px] mb-0.5">{settings.business_location}</div>
          ) : null}
          {settings.till_number ? (
            <div className="text-center text-sm font-bold italic mb-1">
              Till No: {settings.till_number}
            </div>
          ) : null}
          <div className="text-center text-[10px] mb-2">
            {new Date(sale.created_at).toLocaleString()}
          </div>
          <div className="text-center text-[10px] mb-2">
            Served by: {sale.cashier_name}
          </div>
          {sale.sale_number ? (
            <div className="text-center text-[10px] mb-2">#{sale.sale_number}</div>
          ) : null}

          <div className="border-t border-dashed border-black my-2" />

          {sale.items.length > 0 ? (
            sale.items.map((i) => (
              <div key={i.id} className="flex justify-between gap-1 mb-0.5">
                <span className="truncate">
                  {i.quantity}× {i.product_name}
                </span>
                <span className="whitespace-nowrap">{formatMoney(i.line_total)}</span>
              </div>
            ))
          ) : (
            <div className="text-center mb-1">
              {sale.is_credit_payment ? "Credit payment" : "Sale"}
            </div>
          )}

          <div className="border-t border-dashed border-black my-2" />
          <div className="flex justify-between font-bold">
            <span>TOTAL</span>
            <span>{formatMoney(sale.total)}</span>
          </div>
          <div className="flex justify-between capitalize mt-1">
            <span>{sale.payment_method}</span>
            <span>
              {sale.payment_method === "credit"
                ? sale.credit_customer_name
                : formatMoney(sale.amount_paid)}
            </span>
          </div>
          {sale.change_given > 0 && (
            <div className="flex justify-between mt-1">
              <span>Change</span>
              <span>{formatMoney(sale.change_given)}</span>
            </div>
          )}
          <div className="text-center mt-8 pt-2 text-[10px]">
            {settings.receipt_footer || "Thank you for your business!"}
          </div>
        </div>

        <div className="px-5 pb-5 flex gap-2 print:hidden">
          <button
            type="button"
            onClick={doPrint}
            className="flex-1 py-3 rounded-xl bg-slate-900 text-white font-bold"
          >
            Print ({width}mm)
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
  );
}
