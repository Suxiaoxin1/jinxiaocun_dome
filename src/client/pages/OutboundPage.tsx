import { FormEvent, useEffect, useMemo, useState } from "react";
import { apiGet, apiPost } from "../api";
import DataTable from "../components/DataTable";
import FormDialog from "../components/FormDialog";
import ImageThumb from "../components/ImageThumb";
import useTransientMessage from "../hooks/useTransientMessage";
import { dateTimeLocalToIso, toDateTimeLocalValue } from "../formatters";
import { dateInputToLocalNextDayIso, dateInputToLocalStartIso, rowMatchesKeyword, selectFirstVisibleOption } from "../tableTools";
import type { AnyRow, PageProps } from "../types";
import type { LockedPartStock, OutboundOperator, OutboundPlan, OutboundPlanItem, OutboundShipment, StoreProduct } from "../../shared/types";

interface StoreOption {
  id: string;
  name: string;
  remark?: string | null;
}

type PlanTableRow = OutboundPlan & Record<string, unknown> & {
  preOutboundTotal: number;
  shippedTotal: number;
  remainingTotal: number;
};

type LockTableRow = LockedPartStock & Record<string, unknown>;

const emptyOutboundFilters = {
  fromDate: "",
  toDate: "",
  productName: "",
  storeName: "",
  operatorName: "",
  remark: "",
};

const emptyPlanForm = {
  storeId: "",
  operatorName: "",
  remark: "",
};

const emptyShipmentForm = {
  operatorName: "",
  outboundTime: toDateTimeLocalValue(),
  shipmentType: "",
  goodsId: "",
  pickupNo: "",
  cartonCount: "",
  weight: "",
  dimensions: "",
  remark: "",
};

export default function OutboundPage({ currentUser }: PageProps) {
  const [plans, setPlans] = useState<OutboundPlan[]>([]);
  const [stores, setStores] = useState<StoreOption[]>([]);
  const [storeProducts, setStoreProducts] = useState<StoreProduct[]>([]);
  const [stockLocks, setStockLocks] = useState<LockedPartStock[]>([]);
  const [outboundOperators, setOutboundOperators] = useState<OutboundOperator[]>([]);
  const [pendingShipments, setPendingShipments] = useState<OutboundShipment[]>([]);
  const [filters, setFilters] = useState(emptyOutboundFilters);
  const [appliedFilters, setAppliedFilters] = useState(emptyOutboundFilters);
  const [showPlanForm, setShowPlanForm] = useState(false);
  const [showShipmentForm, setShowShipmentForm] = useState(false);
  const [showReviewForm, setShowReviewForm] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<OutboundPlan | null>(null);
  const [reviewShipment, setReviewShipment] = useState<OutboundShipment | null>(null);
  const [planForm, setPlanForm] = useState(emptyPlanForm);
  const [shipmentForm, setShipmentForm] = useState(emptyShipmentForm);
  const [storeSearch, setStoreSearch] = useState("");
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [shipmentQuantities, setShipmentQuantities] = useState<Record<string, string>>({});
  const [finishRemaining, setFinishRemaining] = useState<Record<string, boolean>>({});
  const [reviewQuantities, setReviewQuantities] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [message, setMessage, clearMessage] = useTransientMessage();

  const isAdmin = currentUser.role === "admin";

  async function load() {
    setLoading(true);
    try {
      const [planData, storeData, lockData, outboundOperatorData, shipmentData] = await Promise.all([
        apiGet<{ outboundPlans?: OutboundPlan[] }>("/api/outbound-plans"),
        apiGet<{ stores?: StoreOption[] }>("/api/stores?status=active"),
        apiGet<{ stockLocks?: LockedPartStock[] }>("/api/stock-locks"),
        apiGet<{ outboundOperators?: OutboundOperator[] }>("/api/outbound-operators?status=active"),
        isAdmin ? apiGet<{ outboundShipments?: OutboundShipment[] }>("/api/outbound-shipments?status=待审核") : Promise.resolve({ outboundShipments: [] }),
      ]);

      const nextStores = storeData.stores ?? [];
      setPlans(planData.outboundPlans ?? []);
      setStores(nextStores);
      setStockLocks(lockData.stockLocks ?? []);
      setOutboundOperators(outboundOperatorData.outboundOperators ?? []);
      setPendingShipments(shipmentData.outboundShipments ?? []);
      setPlanForm((current) => {
        if (current.storeId && nextStores.some((store) => store.id === current.storeId)) {
          return current;
        }
        return { ...current, storeId: nextStores[0]?.id ?? "" };
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load().catch((error) => setMessage(error instanceof Error ? error.message : "出库加载失败"));
  }, [isAdmin]);

  useEffect(() => {
    if (!showPlanForm || !planForm.storeId) {
      setStoreProducts([]);
      return;
    }

    let cancelled = false;
    apiGet<{ products?: StoreProduct[] }>(`/api/stores/${planForm.storeId}/products`)
      .then((data) => {
        if (cancelled) {
          return;
        }
        const products = data.products ?? [];
        setStoreProducts(products);
        setQuantities((current) => {
          const next: Record<string, string> = {};
          for (const product of products) {
            next[product.id] = current[product.id] ?? "0";
          }
          return next;
        });
      })
      .catch((error) => {
        if (!cancelled) {
          setMessage(error instanceof Error ? error.message : "店铺产品加载失败");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [showPlanForm, planForm.storeId]);

  const filteredStores = useMemo(
    () => stores.filter((store) => rowMatchesKeyword(store as unknown as AnyRow, ["name", "remark"], storeSearch)),
    [stores, storeSearch],
  );

  useEffect(() => {
    if (!showPlanForm || !storeSearch.trim()) {
      return;
    }
    setPlanForm((current) => ({ ...current, storeId: selectFirstVisibleOption(filteredStores as unknown as AnyRow[], current.storeId) }));
  }, [filteredStores, showPlanForm, storeSearch]);

  const planRows = useMemo(() => {
    return plans.map((plan) => toPlanTableRow(plan)).filter((plan) => planMatchesFilters(plan, appliedFilters));
  }, [plans, appliedFilters]);

  const highlightKeyword = useMemo(() => [
    appliedFilters.productName,
    appliedFilters.storeName,
    appliedFilters.operatorName,
    appliedFilters.remark,
  ].find((value) => value.trim()) ?? "", [appliedFilters]);

  function applyFilters() {
    if (isDateRangeOverLimit(filters.fromDate, filters.toDate, 90)) {
      setMessage("出库时间范围不能超过90天");
      return;
    }
    clearMessage();
    setAppliedFilters(filters);
  }

  function openPlanForm() {
    clearMessage();
    setStoreSearch("");
    setQuantities({});
    setPlanForm({ ...emptyPlanForm, storeId: stores[0]?.id ?? "" });
    setShowPlanForm(true);
  }

  function closePlanForm() {
    clearMessage();
    setShowPlanForm(false);
    setStoreProducts([]);
    setQuantities({});
    setStoreSearch("");
  }

  async function submitPlan(event: FormEvent) {
    event.preventDefault();
    const items = storeProducts
      .map((product) => ({
        productId: product.id,
        preOutboundQuantity: Number(quantities[product.id] ?? 0),
      }))
      .filter((item) => Number.isInteger(item.preOutboundQuantity) && item.preOutboundQuantity > 0);
    if (items.length === 0) {
      setMessage("至少填写一个产品的预出库数量");
      return;
    }

    try {
      await apiPost<{ outboundPlan: OutboundPlan }>("/api/outbound-plans", {
        storeId: planForm.storeId,
        operatorName: planForm.operatorName,
        remark: planForm.remark || null,
        items,
      });
      closePlanForm();
      await load();
      setMessage("预发货清单已创建");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "创建预发货清单失败");
    }
  }

  function openShipmentForm(plan: OutboundPlan) {
    clearMessage();
    setSelectedPlan(plan);
    setShipmentForm({ ...emptyShipmentForm, outboundTime: toDateTimeLocalValue() });
    setShipmentQuantities(Object.fromEntries(plan.items.filter((item) => item.remainingQuantity > 0).map((item) => [item.id, String(item.remainingQuantity)])));
    setFinishRemaining({});
    setShowShipmentForm(true);
  }

  function closeShipmentForm() {
    clearMessage();
    setShowShipmentForm(false);
    setSelectedPlan(null);
    setShipmentQuantities({});
    setFinishRemaining({});
  }

  async function submitShipment(event: FormEvent) {
    event.preventDefault();
    if (!selectedPlan) {
      return;
    }

    const items = selectedPlan.items
      .map((item) => ({
        planItemId: item.id,
        shippedQuantity: Number(shipmentQuantities[item.id] ?? 0),
        finishRemaining: finishRemaining[item.id] ?? false,
      }))
      .filter((item) => Number.isInteger(item.shippedQuantity) && (item.shippedQuantity > 0 || item.finishRemaining));
    if (items.length === 0) {
      setMessage("至少填写一个产品的本次发货数量");
      return;
    }

    try {
      const response = await apiPost<{ outboundShipment?: OutboundShipment }>(`/api/outbound-plans/${selectedPlan.id}/shipments`, {
        operatorName: shipmentForm.operatorName,
        outboundTime: dateTimeLocalToIso(shipmentForm.outboundTime),
        shipmentType: shipmentForm.shipmentType || null,
        goodsId: shipmentForm.goodsId || null,
        pickupNo: shipmentForm.pickupNo || null,
        cartonCount: shipmentForm.cartonCount ? Number(shipmentForm.cartonCount) : null,
        weight: shipmentForm.weight ? Number(shipmentForm.weight) : null,
        dimensions: shipmentForm.dimensions || null,
        remark: shipmentForm.remark || null,
        items,
      });
      if (response.outboundShipment) {
        if (isAdmin) {
          const approveItems = response.outboundShipment.items.map((item) => ({
            shipmentItemId: item.id,
            shippedQuantity: item.shippedQuantity,
          }));
          await apiPost(`/api/outbound-shipments/${response.outboundShipment.id}/approve`, { items: approveItems });
          setMessage("发货已完成");
        } else {
          setPendingShipments((current) => [response.outboundShipment as OutboundShipment, ...current.filter((shipment) => shipment.id !== response.outboundShipment?.id)]);
          setMessage("发货批次已提交审核");
        }
      }
      closeShipmentForm();
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "提交发货批次失败");
    }
  }

  function openReviewForm(shipment: OutboundShipment) {
    clearMessage();
    setReviewShipment(shipment);
    setReviewQuantities(Object.fromEntries(shipment.items.map((item) => [item.id, String(item.shippedQuantity)])));
    setShowReviewForm(true);
  }

  function closeReviewForm() {
    clearMessage();
    setReviewShipment(null);
    setReviewQuantities({});
    setShowReviewForm(false);
  }

  async function submitReview(event: FormEvent) {
    event.preventDefault();
    if (!reviewShipment) {
      return;
    }
    try {
      const items = reviewShipment.items.map((item) => ({
        shipmentItemId: item.id,
        shippedQuantity: Number(reviewQuantities[item.id] ?? item.shippedQuantity),
      }));
      const response = await apiPost<{ outboundShipment: OutboundShipment & { warnings?: unknown[] } }>(
        `/api/outbound-shipments/${reviewShipment.id}/approve`,
        items.length > 0 ? { items } : {},
      );
      const warnings = Array.isArray(response.outboundShipment.warnings) ? response.outboundShipment.warnings : [];
      setPendingShipments((current) => current.filter((item) => item.id !== reviewShipment.id));
      closeReviewForm();
      await load();
      setMessage(warnings.length > 0 ? `发货批次已审核；${warnings.map(String).join("；")}` : "发货批次已审核");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "审核发货批次失败");
    }
  }

  return (
    <section className="page-stack">
      <header className="page-header">
        <h2>出库管理</h2>
      </header>
      {message ? <p className="inline-error">{message}</p> : null}
      <div className="toolbar filter-panel">
        <label>
          开始日期
          <input type="date" value={filters.fromDate} onChange={(event) => setFilters({ ...filters, fromDate: event.target.value })} />
        </label>
        <label>
          结束日期
          <input type="date" value={filters.toDate} onChange={(event) => setFilters({ ...filters, toDate: event.target.value })} />
        </label>
        <label>
          产品
          <input value={filters.productName} onChange={(event) => setFilters({ ...filters, productName: event.target.value })} placeholder="产品名称/SKU" />
        </label>
        <label>
          店铺
          <input value={filters.storeName} onChange={(event) => setFilters({ ...filters, storeName: event.target.value })} placeholder="店铺名称" />
        </label>
        <label>
          出库人
          <input value={filters.operatorName} onChange={(event) => setFilters({ ...filters, operatorName: event.target.value })} placeholder="运营或出货人" />
        </label>
        <label>
          备注
          <input value={filters.remark} onChange={(event) => setFilters({ ...filters, remark: event.target.value })} placeholder="备注" />
        </label>
        <div className="toolbar-actions">
          <button className="primary-button" type="button" onClick={applyFilters}>搜索</button>
          <button className="ghost-button" type="button" onClick={() => { setFilters(emptyOutboundFilters); setAppliedFilters(emptyOutboundFilters); }}>重置</button>
          <button className="secondary-button" type="button" onClick={openPlanForm}>创建预发货清单</button>
        </div>
      </div>
      {showPlanForm ? (
        <FormDialog title="创建预发货清单" onClose={closePlanForm} size="large">
          <form id="outbound-plan-form" className="form-grid dialog-form" onSubmit={submitPlan}>
            <div className="form-field-group wide-field">
              <label className="group-label">选择店铺</label>
              <div className="search-select-control">
                <div className="search-input-wrap">
                  <input 
                    aria-label="搜索店铺" 
                    value={storeSearch} 
                    onChange={(event) => setStoreSearch(event.target.value)} 
                    placeholder="输入店铺名称关键字搜索..." 
                    className="search-input"
                  />
                  {storeSearch.trim() && filteredStores.length > 0 && (
                    <span className="match-badge">匹配 {filteredStores.length} 个</span>
                  )}
                </div>
                <select 
                  aria-label="店铺"
                  value={planForm.storeId} 
                  onChange={(event) => setPlanForm({ ...planForm, storeId: event.target.value })} 
                  required
                  className="select-dropdown"
                >
                  <option value="">{filteredStores.length === 0 ? "无匹配店铺" : "请选择店铺"}</option>
                  {filteredStores.map((store) => (
                    <option key={store.id} value={store.id}>{store.name}</option>
                  ))}
                </select>
              </div>
              <span className="field-hint">先选择店铺，再填写该店铺可出库产品数量</span>
            </div>
            <label>
              运营人员
              <input value={planForm.operatorName} onChange={(event) => setPlanForm({ ...planForm, operatorName: event.target.value })} required />
            </label>
            <label className="wide-field">
              备注
              <input value={planForm.remark} onChange={(event) => setPlanForm({ ...planForm, remark: event.target.value })} />
            </label>
            <div className="wide-field detail-list">
              {storeProducts.length === 0 ? (
                <p className="empty-cell">该店铺暂无可出库产品</p>
              ) : storeProducts.map((product) => (
                <div className="detail-row" key={product.id}>
                  <ImageThumb src={product.imageUrl ?? ""} alt={`${product.name}图片`} />
                  <span>{product.code}</span>
                  <span>{product.name}</span>
                  <label>
                    {product.name}预出库数量
                    <input
                      type="number"
                      min="0"
                      value={quantities[product.id] ?? "0"}
                      onChange={(event) => setQuantities({ ...quantities, [product.id]: event.target.value })}
                    />
                  </label>
                </div>
              ))}
            </div>
            <div className="form-actions dialog-actions">
              <button className="primary-button" type="submit">提交预发货</button>
              <button className="ghost-button" type="button" onClick={closePlanForm}>取 消</button>
            </div>
          </form>
        </FormDialog>
      ) : null}
      {showShipmentForm && selectedPlan ? (
        <FormDialog title="一键发货确认" onClose={closeShipmentForm} size="large">
          <form id="outbound-shipment-form" className="form-grid dialog-form" onSubmit={submitShipment}>
            <label>
              出货人
              {outboundOperators.length === 0 ? (
                <span className="field-hint" style={{ color: "#e74c3c", display: "block", marginTop: "4px" }}>
                  暂无出货人，请到系统管理 → 出库人员管理中添加
                </span>
              ) : (
                <select value={shipmentForm.operatorName} onChange={(event) => setShipmentForm({ ...shipmentForm, operatorName: event.target.value })} required>
                  <option value="">请选择出货人</option>
                  {outboundOperators.map((operator) => (
                    <option key={operator.id} value={operator.name}>{operator.name}</option>
                  ))}
                </select>
              )}
            </label>
            <label>
              出库时间
              <input
                type="datetime-local"
                value={shipmentForm.outboundTime}
                onChange={(event) => setShipmentForm({ ...shipmentForm, outboundTime: event.target.value })}
                required
              />
            </label>
            <label>
              出库形式
              <select value={shipmentForm.shipmentType} onChange={(event) => setShipmentForm({ ...shipmentForm, shipmentType: event.target.value })}>
                <option value="">请选择出库形式</option>
                <option value="jit">jit</option>
                <option value="仓发">仓发</option>
              </select>
            </label>
            <label>
              货品ID
              <input value={shipmentForm.goodsId} onChange={(event) => setShipmentForm({ ...shipmentForm, goodsId: event.target.value })} />
            </label>
            <label>
              揽收单号
              <input value={shipmentForm.pickupNo} onChange={(event) => setShipmentForm({ ...shipmentForm, pickupNo: event.target.value })} />
            </label>
            <label>
              总箱数
              <input type="number" min="1" value={shipmentForm.cartonCount} onChange={(event) => setShipmentForm({ ...shipmentForm, cartonCount: event.target.value })} />
            </label>
            <label>
              重量
              <input type="number" min="0" step="0.01" value={shipmentForm.weight} onChange={(event) => setShipmentForm({ ...shipmentForm, weight: event.target.value })} />
            </label>
            <label>
              尺寸
              <input value={shipmentForm.dimensions} onChange={(event) => setShipmentForm({ ...shipmentForm, dimensions: event.target.value })} />
            </label>
            <label className="wide-field">
              备注
              <input value={shipmentForm.remark} onChange={(event) => setShipmentForm({ ...shipmentForm, remark: event.target.value })} />
            </label>
            <div className="wide-field detail-list">
              {selectedPlan.items.filter((item) => item.remainingQuantity > 0).map((item) => (
                <div className="detail-row" key={item.id}>
                  <span>{item.productCode}</span>
                  <span>{item.productName}</span>
                  <span>剩余待发：{item.remainingQuantity}</span>
                  <label>
                    {item.productName}本次发货数量
                    <input
                      type="number"
                      min="0"
                      max={item.remainingQuantity}
                      value={shipmentQuantities[item.id] ?? "0"}
                      onChange={(event) => setShipmentQuantities({ ...shipmentQuantities, [item.id]: event.target.value })}
                    />
                  </label>
                  <label className="inline-check">
                    <input
                      type="checkbox"
                      checked={finishRemaining[item.id] ?? false}
                      onChange={(event) => setFinishRemaining({ ...finishRemaining, [item.id]: event.target.checked })}
                    />
                    发货完结
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      setShipmentQuantities({ ...shipmentQuantities, [item.id]: "0" });
                      setFinishRemaining({ ...finishRemaining, [item.id]: true });
                    }}
                  >
                    移出本次发货单
                  </button>
                </div>
              ))}
            </div>
            <p className="wide-field field-hint">
              待发货总件数：{selectedPlan.items.reduce((total, item) => total + item.remainingQuantity, 0)}
              ，本次发货商品数/总商品数：{selectedPlan.items.filter((item) => Number(shipmentQuantities[item.id] ?? 0) > 0).length}/{selectedPlan.items.filter((item) => item.remainingQuantity > 0).length}
            </p>
            <div className="form-actions dialog-actions">
              <button className="primary-button" type="submit">确认发货，提交审核</button>
              <button className="ghost-button" type="button" onClick={closeShipmentForm}>取 消</button>
            </div>
          </form>
        </FormDialog>
      ) : null}
      {showReviewForm && reviewShipment ? (
        <FormDialog title="审核发货批次" onClose={closeReviewForm} size="large">
          <form className="form-grid dialog-form" onSubmit={submitReview}>
            <div className="wide-field detail-list">
              {reviewShipment.items.length > 0 ? reviewShipment.items.map((item) => (
                <div className="detail-row" key={item.id}>
                  <span>{item.productCode}</span>
                  <span>{item.productName}</span>
                  <span>提交时剩余：{item.beforeRemainingQuantity}</span>
                  <label>
                    {item.productName}审核发货数量
                    <input
                      type="number"
                      min="0"
                      max={item.beforeRemainingQuantity}
                      value={reviewQuantities[item.id] ?? String(item.shippedQuantity)}
                      onChange={(event) => setReviewQuantities({ ...reviewQuantities, [item.id]: event.target.value })}
                      required
                    />
                  </label>
                </div>
              )) : <p className="field-hint">确认审核此发货批次。</p>}
            </div>
            <div className="form-actions dialog-actions">
              <button className="primary-button" type="submit">确认审核</button>
              <button className="ghost-button" type="button" onClick={closeReviewForm}>取 消</button>
            </div>
          </form>
        </FormDialog>
      ) : null}
      <DataTable<PlanTableRow>
        rows={planRows}
        loading={loading}
        highlightKeyword={highlightKeyword}
        columns={[
          { key: "planNo", header: "预发货单号" },
          { key: "storeName", header: "店铺" },
          { key: "operatorName", header: "运营人员" },
          { key: "status", header: "状态" },
          { key: "preOutboundTotal", header: "预出库总数" },
          { key: "shippedTotal", header: "累计已发" },
          { key: "remainingTotal", header: "剩余待发" },
          {
            key: "items",
            header: "产品明细",
            render: (plan) => (
              <div className="detail-list compact-detail-list">
                {plan.items.map((item) => (
                  <div className="detail-row" key={item.id}>
                    <ImageThumb src={item.productImageUrl ?? ""} alt={`${item.productName}图片`} />
                    <span>{item.productCode}</span>
                    <span>{item.productName}</span>
                    <span>预出库 {item.preOutboundQuantity}</span>
                    <span>已发 {item.shippedQuantity}</span>
                    <span>剩余 {item.remainingQuantity}</span>
                  </div>
                ))}
              </div>
            ),
          },
          { key: "remark", header: "备注" },
          {
            key: "actions",
            header: "操作",
            render: (plan) => {
              const pendingShipment = pendingShipments.find((shipment) => shipment.planId === plan.id && shipment.status === "待审核");
              return (
                <div className="row-actions">
                  {plan.remainingTotal > 0 ? (
                    <button type="button" onClick={() => openShipmentForm(plan)}>一键发货</button>
                  ) : null}
                  {isAdmin && pendingShipment ? (
                    <button type="button" onClick={() => openReviewForm(pendingShipment)}>审核发货批次</button>
                  ) : null}
                </div>
              );
            },
          },
        ]}
      />
      {stockLocks.length > 0 ? (
        <section className="page-stack">
          <h3>配件锁定库存</h3>
          <DataTable<LockTableRow>
            rows={stockLocks as LockTableRow[]}
            columns={[
              { key: "partCode", header: "配件编号" },
              { key: "partName", header: "配件" },
              { key: "currentStock", header: "现货库存" },
              { key: "lockedQuantity", header: "锁定库存" },
              { key: "availableQuantity", header: "可用库存" },
            ]}
          />
        </section>
      ) : null}
    </section>
  );
}

function toPlanTableRow(plan: OutboundPlan): PlanTableRow {
  return {
    ...plan,
    preOutboundTotal: sumItems(plan.items, "preOutboundQuantity"),
    shippedTotal: sumItems(plan.items, "shippedQuantity"),
    remainingTotal: sumItems(plan.items, "remainingQuantity"),
  };
}

function sumItems(items: OutboundPlanItem[], key: "preOutboundQuantity" | "shippedQuantity" | "remainingQuantity") {
  return items.reduce((total, item) => total + item[key], 0);
}

function planMatchesFilters(plan: PlanTableRow, filters: typeof emptyOutboundFilters) {
  if (filters.fromDate || filters.toDate) {
    const createdAt = new Date(plan.createdAt).getTime();
    const from = filters.fromDate ? new Date(dateInputToLocalStartIso(filters.fromDate)).getTime() : Number.NEGATIVE_INFINITY;
    const to = filters.toDate ? new Date(dateInputToLocalNextDayIso(filters.toDate)).getTime() : Number.POSITIVE_INFINITY;
    if (createdAt < from || createdAt >= to) {
      return false;
    }
  }
  if (filters.storeName && !containsText(plan.storeName, filters.storeName)) {
    return false;
  }
  if (filters.operatorName && !containsText(plan.operatorName, filters.operatorName)) {
    return false;
  }
  if (filters.remark && !containsText(plan.remark, filters.remark)) {
    return false;
  }
  if (filters.productName) {
    return plan.items.some((item) => containsText(item.productCode, filters.productName) || containsText(item.productName, filters.productName));
  }
  return true;
}

function containsText(value: unknown, keyword: string) {
  return String(value ?? "").toLowerCase().includes(keyword.trim().toLowerCase());
}

function isDateRangeOverLimit(fromDate: string, toDate: string, maxDays: number) {
  if (!fromDate || !toDate) {
    return false;
  }
  const from = new Date(`${fromDate}T00:00:00`).getTime();
  const to = new Date(`${toDate}T00:00:00`).getTime();
  return to >= from && (to - from) / 86400000 > maxDays;
}
