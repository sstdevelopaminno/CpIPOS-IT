"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";

type Language = "th" | "en";

type Product = {
  id: string;
  name: { th: string; en: string };
  price: number;
  unit: { th: string; en: string };
  image: string;
  category: "all" | "noodle" | "snack" | "drink" | "dessert" | "promo";
};

type OrderRow = {
  id: string;
  qty: number;
};

const categories: Record<Language, Array<{ key: Product["category"]; label: string }>> = {
  th: [
    { key: "all", label: "ทั้งหมด" },
    { key: "noodle", label: "ก๋วยเตี๋ยว" },
    { key: "snack", label: "ของทานเล่น" },
    { key: "drink", label: "เครื่องดื่ม" },
    { key: "dessert", label: "ขนมหวาน" },
    { key: "promo", label: "โปรโมชั่น" }
  ],
  en: [
    { key: "all", label: "All" },
    { key: "noodle", label: "Noodles" },
    { key: "snack", label: "Snacks" },
    { key: "drink", label: "Drinks" },
    { key: "dessert", label: "Desserts" },
    { key: "promo", label: "Promotion" }
  ]
};

const products: Product[] = [
  {
    id: "p1",
    name: { th: "ช็อกโกแลตเค้ก", en: "Chocolate Cake" },
    price: 95,
    unit: { th: "ชิ้น", en: "piece" },
    image: "https://images.unsplash.com/photo-1578985545062-69928b1d9587?w=500",
    category: "dessert"
  },
  {
    id: "p2",
    name: { th: "แพนเค้ก", en: "Pancake" },
    price: 99,
    unit: { th: "จาน", en: "plate" },
    image: "https://images.unsplash.com/photo-1528207776546-365bb710ee93?w=500",
    category: "dessert"
  },
  {
    id: "p3",
    name: { th: "ไอศกรีมวานิลลา", en: "Vanilla Ice Cream" },
    price: 69,
    unit: { th: "ถ้วย", en: "cup" },
    image: "https://images.unsplash.com/photo-1488900128323-21503983a07e?w=500",
    category: "dessert"
  },
  {
    id: "p4",
    name: { th: "ซุปไก่ส้มหมู", en: "Pork Noodle Soup" },
    price: 89,
    unit: { th: "ชาม", en: "bowl" },
    image: "https://images.unsplash.com/photo-1569718212165-3a8278d5f624?w=500",
    category: "noodle"
  },
  {
    id: "p5",
    name: { th: "กาแฟลาเต้", en: "Latte" },
    price: 65,
    unit: { th: "แก้ว", en: "cup" },
    image: "https://images.unsplash.com/photo-1509042239860-f550ce710b93?w=500",
    category: "drink"
  },
  {
    id: "p6",
    name: { th: "ชาไทย", en: "Thai Tea" },
    price: 55,
    unit: { th: "แก้ว", en: "cup" },
    image: "https://images.unsplash.com/photo-1514432324607-a09d9b4aefdd?w=500",
    category: "drink"
  },
  {
    id: "p7",
    name: { th: "ขนมปังไส้แยม", en: "Jam Toast" },
    price: 75,
    unit: { th: "ชิ้น", en: "piece" },
    image: "https://images.unsplash.com/photo-1528736235302-52922df5c122?w=500",
    category: "snack"
  },
  {
    id: "p8",
    name: { th: "น้ำส้มมะนาว", en: "Lime Orange" },
    price: 60,
    unit: { th: "แก้ว", en: "cup" },
    image: "https://images.unsplash.com/photo-1544145945-f90425340c7e?w=500",
    category: "drink"
  }
];

const initialOrderRows: OrderRow[] = [
  { id: "p4", qty: 2 },
  { id: "p5", qty: 1 },
  { id: "p1", qty: 1 }
];

function currency(value: number) {
  return `฿${value.toFixed(2)}`;
}

export function PosPreviewBoard({ lang }: { lang: Language }) {
  const [activeCategory, setActiveCategory] = useState(0);
  const [orderRows, setOrderRows] = useState<OrderRow[]>(initialOrderRows);
  const [currentPage, setCurrentPage] = useState(1);
  const [cartCurrentPage, setCartCurrentPage] = useState(1);
  const [columnsPerRow, setColumnsPerRow] = useState(4);

  const selectedCategory = categories[lang][activeCategory]?.key ?? "all";
  const visibleProducts = useMemo(() => {
    if (selectedCategory === "all") return products;
    return products.filter((product) => product.category === selectedCategory || selectedCategory === "promo");
  }, [selectedCategory]);

  useEffect(() => {
    const resolveColumns = () => {
      if (window.innerWidth >= 1280) return 4;
      if (window.innerWidth >= 768) return 3;
      return 2;
    };

    const syncColumns = () => {
      setColumnsPerRow(resolveColumns());
    };

    syncColumns();
    window.addEventListener("resize", syncColumns);
    return () => window.removeEventListener("resize", syncColumns);
  }, []);

  const itemsPerPage = columnsPerRow * 3;
  const totalPages = Math.max(1, Math.ceil(visibleProducts.length / itemsPerPage));
  const shouldShowPagination = totalPages > 1;
  const safeCurrentPage = Math.min(currentPage, totalPages);

  const pagedProducts = useMemo(() => {
    const start = (safeCurrentPage - 1) * itemsPerPage;
    return visibleProducts.slice(start, start + itemsPerPage);
  }, [itemsPerPage, safeCurrentPage, visibleProducts]);

  const cartItemsPerPage = 5;
  const cartTotalPages = Math.max(1, Math.ceil(orderRows.length / cartItemsPerPage));
  const safeCartCurrentPage = Math.min(cartCurrentPage, cartTotalPages);
  const shouldShowCartPagination = cartTotalPages > 1;
  const pagedOrderRows = useMemo(() => {
    const start = (safeCartCurrentPage - 1) * cartItemsPerPage;
    return orderRows.slice(start, start + cartItemsPerPage);
  }, [orderRows, safeCartCurrentPage]);

  const subtotal = useMemo(
    () =>
      orderRows.reduce((sum, row) => {
        const product = products.find((item) => item.id === row.id);
        if (!product) return sum;
        return sum + product.price * row.qty;
      }, 0),
    [orderRows]
  );

  const tax = subtotal * 0.07;
  const total = subtotal + tax;

  const increaseQty = (id: string) => {
    setOrderRows((currentRows) =>
      currentRows.map((row) => (row.id === id ? { ...row, qty: row.qty + 1 } : row))
    );
  };

  const decreaseQty = (id: string) => {
    setOrderRows((currentRows) =>
      currentRows.flatMap((row) => {
        if (row.id !== id) return [row];
        if (row.qty <= 1) return [];
        return [{ ...row, qty: row.qty - 1 }];
      })
    );
  };

  const removeRow = (id: string) => {
    setOrderRows((currentRows) => currentRows.filter((row) => row.id !== id));
  };

  const addProductToOrder = (id: string) => {
    setOrderRows((currentRows) => {
      const existingRow = currentRows.find((row) => row.id === id);
      if (existingRow) {
        return currentRows.map((row) => (row.id === id ? { ...row, qty: row.qty + 1 } : row));
      }
      return [...currentRows, { id, qty: 1 }];
    });
  };

  const clearOrder = () => {
    setOrderRows([]);
    setCartCurrentPage(1);
  };

  return (
    <div className="pos-board pos-board--pixel grid min-h-[calc(100vh-1rem)] gap-2 rounded-xl border border-slate-300 bg-slate-100 p-0 xl:grid-cols-[minmax(0,1fr)_355px]">
      <section className="pos-board-main flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-slate-300 bg-slate-50">
        <div className="pos-topbar-blank shrink-0 border-b border-slate-300" />

        <div className="pos-board-content flex min-h-0 flex-1 flex-col p-2">
          <div className="pos-tabs-row mb-2 flex items-center gap-1.5 overflow-x-auto pb-1">
            {categories[lang].map((category, index) => {
              const isActive = index === activeCategory;
              return (
                <button
                  key={category.label}
                  type="button"
                  onClick={() => {
                    setActiveCategory(index);
                    setCurrentPage(1);
                  }}
                  className={`whitespace-nowrap rounded-lg border px-3 py-1.5 text-[12px] font-bold leading-none md:px-3.5 md:py-2 ${
                    isActive
                      ? "border-orange-500 bg-gradient-to-b from-orange-400 to-orange-500 text-white"
                      : "border-slate-300 bg-white text-slate-800"
                  }`}
                >
                  {category.label}
                </button>
              );
            })}
            <button
              type="button"
              className="ml-auto whitespace-nowrap rounded-lg border border-slate-300 bg-white px-3.5 py-1.5 text-[12px] font-bold leading-none text-slate-800 md:py-2"
            >
              ☷ {lang === "th" ? "จัดการเมนู" : "Manage Menu"}
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="pos-products-grid grid grid-cols-2 gap-2 md:grid-cols-3 lg:gap-2.5 xl:grid-cols-4">
              {pagedProducts.map((product) => (
                <button
                  key={product.id}
                  type="button"
                  onClick={() => addProductToOrder(product.id)}
                  className="pos-product-card overflow-hidden rounded-lg border border-slate-300 bg-white text-left"
                >
                  <div className="relative h-[102px] w-full md:h-[108px]">
                    <Image
                      src={product.image}
                      alt={product.name[lang]}
                      fill
                      sizes="(max-width: 1024px) 50vw, 25vw"
                      className="object-cover"
                    />
                  </div>
                  <div className="p-2.5">
                    <p className="pos-product-title text-[13px] font-bold leading-[1.34] text-slate-900 md:text-[14px]">
                      {product.name[lang]}
                    </p>
                    <p className="pos-product-price mt-2 text-[18px] font-extrabold leading-none text-orange-600 md:text-[20px]">฿{product.price}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {shouldShowPagination ? (
            <div className="pos-pagination-row mt-2 flex justify-center gap-1.5">
              <button
                type="button"
                onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                disabled={safeCurrentPage === 1}
                className="grid h-7 w-7 place-items-center rounded-md border border-slate-300 bg-white text-[12px] font-bold text-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
                aria-label={lang === "th" ? "หน้าก่อนหน้า" : "Previous page"}
              >
                ‹
              </button>
              {Array.from({ length: totalPages }, (_, index) => index + 1).map((page) => (
                <button
                  key={page}
                  type="button"
                  onClick={() => setCurrentPage(page)}
                  className={`grid h-7 w-7 place-items-center rounded-md border text-[12px] font-bold ${
                    page === safeCurrentPage
                      ? "border-orange-500 bg-orange-500 text-white"
                      : "border-slate-300 bg-white text-slate-700"
                  }`}
                >
                  {page}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
                disabled={safeCurrentPage === totalPages}
                className="grid h-7 w-7 place-items-center rounded-md border border-slate-300 bg-white text-[12px] font-bold text-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
                aria-label={lang === "th" ? "หน้าถัดไป" : "Next page"}
              >
                ›
              </button>
            </div>
          ) : null}
        </div>
      </section>

      <aside className="pos-board-cart flex min-h-0 flex-col overflow-hidden rounded-xl border border-slate-300 bg-slate-50">
        <div className="flex shrink-0 items-center justify-between border-b border-slate-300 px-3 py-2.5">
          <h3 className="text-[20px] font-extrabold leading-tight text-slate-900 md:text-[21px]">
            {lang === "th" ? `รายการสินค้า (${orderRows.length})` : `Order Items (${orderRows.length})`}
          </h3>
          <button type="button" onClick={clearOrder} className="text-[13px] font-bold leading-none text-red-500">
            {lang === "th" ? "ล้างรายการ" : "Clear"}
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          <div className="space-y-2.5">
            {pagedOrderRows.map((row) => {
              const product = products.find((item) => item.id === row.id);
              if (!product) return null;

              return (
                <div
                  key={row.id}
                  className="grid grid-cols-[44px_minmax(0,1fr)_62px_16px] items-center gap-2 rounded-lg border border-slate-300 bg-white p-2"
                >
                  <Image
                    src={product.image}
                    alt={product.name[lang]}
                    width={44}
                    height={44}
                    className="h-11 w-11 rounded-full object-cover"
                  />
                  <div>
                    <p className="text-[13px] font-bold leading-[1.3] text-slate-900 md:text-[14px]">{product.name[lang]}</p>
                    <p className="text-[11px] text-slate-500">
                      ฿{product.price} / {product.unit[lang]}
                    </p>
                    <div className="mt-1 inline-flex overflow-hidden rounded-md border border-slate-300 bg-slate-50">
                      <button
                        type="button"
                        className="h-6 min-w-6 text-[14px] font-bold leading-none text-slate-700"
                        onClick={() => decreaseQty(row.id)}
                        aria-label={lang === "th" ? "ลดจำนวน" : "Decrease quantity"}
                      >
                        -
                      </button>
                      <span className="grid min-w-7 place-items-center text-[13px] font-bold text-slate-800">{row.qty}</span>
                      <button
                        type="button"
                        className="h-6 min-w-6 text-[14px] font-bold leading-none text-slate-700"
                        onClick={() => increaseQty(row.id)}
                        aria-label={lang === "th" ? "เพิ่มจำนวน" : "Increase quantity"}
                      >
                        +
                      </button>
                    </div>
                  </div>
                  <div className="text-right text-[20px] font-extrabold leading-none text-slate-900 md:text-[22px]">
                    ฿{(product.price * row.qty).toFixed(0)}
                  </div>
                  <button
                    type="button"
                    className="text-[19px] leading-none text-slate-500"
                    onClick={() => removeRow(row.id)}
                    aria-label={lang === "th" ? "ลบรายการ" : "Delete item"}
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>

          {shouldShowCartPagination ? (
            <div className="mt-2 flex items-center justify-center gap-1.5">
              <button
                type="button"
                onClick={() => setCartCurrentPage((page) => Math.max(1, page - 1))}
                disabled={safeCartCurrentPage === 1}
                className="grid h-7 w-7 place-items-center rounded-md border border-slate-300 bg-white text-[12px] font-bold text-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
                aria-label={lang === "th" ? "หน้ารายการก่อนหน้า" : "Previous cart page"}
              >
                ‹
              </button>
              {Array.from({ length: cartTotalPages }, (_, index) => index + 1).map((page) => (
                <button
                  key={page}
                  type="button"
                  onClick={() => setCartCurrentPage(page)}
                  className={`grid h-7 w-7 place-items-center rounded-md border text-[12px] font-bold ${
                    page === safeCartCurrentPage
                      ? "border-orange-500 bg-orange-500 text-white"
                      : "border-slate-300 bg-white text-slate-700"
                  }`}
                >
                  {page}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setCartCurrentPage((page) => Math.min(cartTotalPages, page + 1))}
                disabled={safeCartCurrentPage === cartTotalPages}
                className="grid h-7 w-7 place-items-center rounded-md border border-slate-300 bg-white text-[12px] font-bold text-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
                aria-label={lang === "th" ? "หน้ารายการถัดไป" : "Next cart page"}
              >
                ›
              </button>
            </div>
          ) : null}
        </div>

        <div className="shrink-0 border-t border-slate-300 bg-slate-50 px-2 pb-2 pt-2">
          <div className="rounded-lg border border-slate-300 bg-white p-2.5">
            <div className="mb-1.5 flex items-center justify-between text-[13px] leading-[1.28] text-slate-700">
              <span>{lang === "th" ? "ส่วนลด" : "Discount"}</span>
              <span className="min-w-[84px] rounded-md border border-slate-300 bg-slate-50 px-2 py-0.5 text-right">
                ฿ 0.00
              </span>
            </div>
            <div className="mb-1.5 flex items-center justify-between text-[13px] leading-[1.28] text-slate-700">
              <span>{lang === "th" ? "ภาษี (7%)" : "Tax (7%)"}</span>
              <span>{currency(tax)}</span>
            </div>
            <div className="mt-2 flex items-center justify-between border-t-2 border-dashed border-slate-400 pt-2 text-[16px] font-extrabold leading-[1.05] text-slate-900">
              <span className="pos-total-label text-[24px] md:text-[25px]">{lang === "th" ? "ยอดรวม" : "Total"}</span>
              <span className="pos-total-value text-[24px] text-orange-600 md:text-[25px]">{currency(total)}</span>
            </div>
          </div>

          <div className="mt-2 grid grid-cols-3 gap-2">
            <button
              type="button"
              className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-[13px] font-bold text-slate-700"
            >
              {lang === "th" ? "ยกเลิกบิล" : "Cancel"}
            </button>
            <button
              type="button"
              className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-[13px] font-bold text-slate-700"
            >
              {lang === "th" ? "พักบิล" : "Hold"}
            </button>
            <button
              type="button"
              className="rounded-lg border border-orange-200 bg-orange-50 px-2 py-1.5 text-[13px] font-bold text-orange-600"
            >
              {lang === "th" ? "โปรโมชั่น" : "Promotion"}
            </button>
          </div>

          <button
            type="button"
            className="pos-pay-btn mt-2 w-full rounded-lg border border-orange-500 bg-gradient-to-b from-orange-400 to-orange-500 py-2 text-[20px] font-extrabold leading-none text-white md:text-[22px]"
          >
            {lang === "th" ? "ชำระเงิน" : "Pay"}
          </button>
        </div>
      </aside>
    </div>
  );
}
