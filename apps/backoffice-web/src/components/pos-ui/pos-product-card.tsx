"use client";

type Props = {
  title: string;
  price: number;
  secondaryPrice?: number | null;
  secondaryLabel?: string;
  subtitle?: string;
  imageUrl?: string;
  badge?: string;
  disabled?: boolean;
  onAdd: () => void;
};

function formatPrice(value: number): string {
  return Number.isInteger(value) ? `฿${value}` : `฿${value.toFixed(2)}`;
}

export function PosProductCard({ title, price, secondaryPrice, secondaryLabel, subtitle, imageUrl, badge, disabled = false, onAdd }: Props) {
  const hasSecondaryPrice = Number.isFinite(secondaryPrice) && Number(secondaryPrice) >= 0;
  return (
    <button type="button" className={`posui-product-card ${disabled ? "is-disabled" : ""}`} onClick={onAdd} disabled={disabled}>
      <div
        className="posui-product-card__image"
        style={imageUrl ? { backgroundImage: `url(${imageUrl})` } : undefined}
        aria-hidden
      >
        {!imageUrl ? <span>{title.slice(0, 1).toUpperCase()}</span> : null}
      </div>
      <div className="posui-product-card__body">
        <p className="posui-product-card__title">{title}</p>
        {subtitle ? <p className="posui-product-card__subtitle">{subtitle}</p> : null}
        {badge ? <p className={`posui-product-card__badge ${disabled ? "is-danger" : ""}`}>{badge}</p> : null}
        <p className="posui-product-card__price">{formatPrice(price)}</p>
        {hasSecondaryPrice ? (
          <p className="posui-product-card__price-alt">
            {secondaryLabel ?? "Delivery"}: {formatPrice(Number(secondaryPrice))}
          </p>
        ) : null}
      </div>
    </button>
  );
}
