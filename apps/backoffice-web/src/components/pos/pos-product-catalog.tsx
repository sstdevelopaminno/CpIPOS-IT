"use client";

import { memo } from "react";
import { PosProductCard } from "@/components/pos-ui/pos-product-card";
import { PosProductGrid } from "@/components/pos-ui/pos-product-grid";

type ProductCatalogItem = {
  id: string;
  sku: string;
  name: string;
  category: string;
  price: number;
  is_active: boolean;
  stock_on_hand_units?: number | null;
  is_out_of_stock?: boolean;
  has_recipe_deduction?: boolean;
};

type Props = {
  products: ProductCatalogItem[];
  isDeliveryMode: boolean;
  storefrontPriceLabel: string;
  stockRemainingLabel?: string;
  outOfStockLabel?: string;
  getProductPrice: (product: ProductCatalogItem) => number;
  onAddProduct: (product: ProductCatalogItem) => void;
};

function PosProductCatalogInner({ products, isDeliveryMode, storefrontPriceLabel, stockRemainingLabel = "Stock", outOfStockLabel = "Out of stock", getProductPrice, onAddProduct }: Props) {
  return (
    <PosProductGrid>
      {products.map((product) => (
        <PosProductCard
          key={product.id}
          title={product.name}
          subtitle={product.sku && product.sku !== product.id ? product.sku : undefined}
          price={getProductPrice(product)}
          secondaryPrice={isDeliveryMode ? Number(product.price) : null}
          secondaryLabel={isDeliveryMode ? storefrontPriceLabel : undefined}
          badge={
            product.is_out_of_stock
              ? outOfStockLabel
              : product.stock_on_hand_units !== null && product.stock_on_hand_units !== undefined
                ? `${stockRemainingLabel}: ${product.stock_on_hand_units}`
                : undefined
          }
          disabled={product.is_out_of_stock === true}
          onAdd={() => onAddProduct(product)}
        />
      ))}
    </PosProductGrid>
  );
}

export const PosProductCatalog = memo(PosProductCatalogInner);
