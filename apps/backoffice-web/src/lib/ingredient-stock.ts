export type StockUnit = "kg" | "kilogram" | "g" | "gram" | "khid" | "bag";

export type ConvertToGramsOptions = {
  weightPerBagInGrams?: number;
};

export type IngredientStock = {
  id: string;
  name: string;
  stockInGrams: number;
  minimumStockInGrams?: number;
};

export type RecipeIngredient = {
  productId: string;
  ingredientId: string;
  usageInGrams: number;
};

export type SaleLine = {
  productId: string;
  quantitySold: number;
};

export type DeductionResult = {
  ingredientId: string;
  requiredGrams: number;
  remainingGrams: number;
};

const GRAMS_PER_KILOGRAM = 1000;
const GRAMS_PER_KHID = 100;

function normalizeUnit(unit: string): StockUnit {
  const normalized = unit.trim().toLowerCase();
  if (normalized === "kg" || normalized === "kilogram") return normalized;
  if (normalized === "g" || normalized === "gram") return normalized;
  if (normalized === "bag") return normalized;
  if (normalized === "khid" || normalized === "ขีด") return "khid";
  throw new Error(`INVALID_UNIT:${unit}`);
}

function assertPositiveFinite(value: number, fieldName: string) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`INVALID_${fieldName.toUpperCase()}`);
  }
}

export function toIntegerGrams(value: number): number {
  if (!Number.isFinite(value)) {
    throw new Error("INVALID_GRAMS");
  }
  return Math.round(value);
}

export function convertToGrams(value: number, unit: StockUnit | string, options: ConvertToGramsOptions = {}): number {
  assertPositiveFinite(value, "value");
  const normalizedUnit = normalizeUnit(unit);

  if (normalizedUnit === "kg" || normalizedUnit === "kilogram") {
    return toIntegerGrams(value * GRAMS_PER_KILOGRAM);
  }

  if (normalizedUnit === "g" || normalizedUnit === "gram") {
    return toIntegerGrams(value);
  }

  if (normalizedUnit === "khid") {
    return toIntegerGrams(value * GRAMS_PER_KHID);
  }

  const weightPerBagInGrams = Number(options.weightPerBagInGrams);
  assertPositiveFinite(weightPerBagInGrams, "weight_per_bag_in_grams");
  return toIntegerGrams(value * weightPerBagInGrams);
}

export function calculateRecipeUsage(recipeIngredients: RecipeIngredient[], quantitySold: number): Array<{ ingredientId: string; requiredGrams: number }> {
  assertPositiveFinite(quantitySold, "quantity_sold");
  const usageMap = new Map<string, number>();

  for (const line of recipeIngredients) {
    const usageInGrams = toIntegerGrams(Number(line.usageInGrams));
    if (usageInGrams <= 0) {
      throw new Error(`INVALID_RECIPE_USAGE:${line.ingredientId}`);
    }
    const requiredGrams = toIntegerGrams(usageInGrams * quantitySold);
    usageMap.set(line.ingredientId, (usageMap.get(line.ingredientId) ?? 0) + requiredGrams);
  }

  return Array.from(usageMap.entries()).map(([ingredientId, requiredGrams]) => ({
    ingredientId,
    requiredGrams
  }));
}

export function validateStockBeforeDeduction(
  ingredient: IngredientStock,
  requiredGrams: number,
  options: { allowNegativeStock?: boolean } = {}
): { ok: boolean; reason?: string } {
  const allowNegativeStock = Boolean(options.allowNegativeStock);
  const required = toIntegerGrams(requiredGrams);
  if (required <= 0) {
    return { ok: false, reason: "required_grams_must_be_positive" };
  }

  if (!allowNegativeStock && ingredient.stockInGrams < required) {
    return { ok: false, reason: "insufficient_stock" };
  }

  return { ok: true };
}

export function formatStockDisplay(stockInGrams: number, options: { locale?: "th" | "en"; showKhidHint?: boolean } = {}): string {
  const locale = options.locale ?? "en";
  const grams = toIntegerGrams(stockInGrams);
  const showKhidHint = options.showKhidHint ?? true;

  if (Math.abs(grams) >= GRAMS_PER_KILOGRAM) {
    const kg = grams / GRAMS_PER_KILOGRAM;
    const kgText = Number(kg.toFixed(3)).toString();
    return locale === "th" ? `${kgText} กก.` : `${kgText} kg`;
  }

  if (showKhidHint && Math.abs(grams) < GRAMS_PER_KILOGRAM) {
    const khidValue = Number((grams / GRAMS_PER_KHID).toFixed(3)).toString();
    return locale === "th" ? `${grams} กรัม (${khidValue} ขีด)` : `${grams} g (${khidValue} khid)`;
  }

  return locale === "th" ? `${grams} กรัม` : `${grams} g`;
}

export function deductStockForSale(
  productId: string,
  quantitySold: number,
  recipeIngredients: RecipeIngredient[],
  ingredientStocks: IngredientStock[],
  options: { allowNegativeStock?: boolean } = {}
): {
  deductions: DeductionResult[];
  updatedIngredientStocks: IngredientStock[];
} {
  const allowNegativeStock = Boolean(options.allowNegativeStock);
  assertPositiveFinite(quantitySold, "quantity_sold");

  const applicableRecipeLines = recipeIngredients.filter((line) => line.productId === productId);
  if (applicableRecipeLines.length === 0) {
    return {
      deductions: [],
      updatedIngredientStocks: ingredientStocks
    };
  }

  const usage = calculateRecipeUsage(applicableRecipeLines, quantitySold);
  const stockMap = new Map(ingredientStocks.map((item) => [item.id, { ...item, stockInGrams: toIntegerGrams(item.stockInGrams) }]));
  const deductions: DeductionResult[] = [];

  for (const line of usage) {
    const ingredient = stockMap.get(line.ingredientId);
    if (!ingredient) {
      throw new Error(`INGREDIENT_NOT_FOUND:${line.ingredientId}`);
    }
    const stockCheck = validateStockBeforeDeduction(ingredient, line.requiredGrams, { allowNegativeStock });
    if (!stockCheck.ok) {
      throw new Error(`INSUFFICIENT_STOCK:${line.ingredientId}`);
    }

    ingredient.stockInGrams = ingredient.stockInGrams - line.requiredGrams;
    deductions.push({
      ingredientId: line.ingredientId,
      requiredGrams: line.requiredGrams,
      remainingGrams: ingredient.stockInGrams
    });
  }

  return {
    deductions,
    updatedIngredientStocks: Array.from(stockMap.values())
  };
}
