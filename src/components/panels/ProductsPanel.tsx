import { useState, type KeyboardEvent } from "react";
import { useStore } from "../../store/useStore";
import type { Client, Product } from "../../types";

type ListSubTab = "products" | "clients";

export default function ProductsPanel() {
  const products = useStore((s) => s.products);
  const clients = useStore((s) => s.clients);
  const addProduct = useStore((s) => s.addProduct);

  const [activeTab, setActiveTab] = useState<ListSubTab>("products");
  const [newName, setNewName] = useState("");
  const activeCount = activeTab === "products" ? products.length : clients.length;

  const onAdd = async () => {
    const name = newName.trim();
    if (!name) return;
    await addProduct(name);
    setNewName("");
  };

  return (
    <section className="products-page">
      <div className="products-shell">
        <div className="products-heading">
          <div className="products-heading-main">
            <h1>Lista</h1>
            <span className="products-count">{activeCount}</span>
          </div>
          <div className="products-tabs" role="tablist" aria-label="Lista">
            <button
              className={`products-tab ${activeTab === "products" ? "active" : ""}`}
              role="tab"
              aria-selected={activeTab === "products"}
              onClick={() => setActiveTab("products")}
            >
              Peixes
            </button>
            <button
              className={`products-tab ${activeTab === "clients" ? "active" : ""}`}
              role="tab"
              aria-selected={activeTab === "clients"}
              onClick={() => setActiveTab("clients")}
            >
              Clientes
            </button>
          </div>
        </div>

        {activeTab === "products" ? (
          <>
            <div className="products-toolbar">
              <div className="products-add">
                <input
                  className="field-control"
                  value={newName}
                  placeholder="Nome do produto"
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void onAdd();
                  }}
                />
                <button className="btn btn-primary" disabled={!newName.trim()} onClick={onAdd}>
                  + Adicionar
                </button>
              </div>
            </div>

            <div className="products-list">
              <div className="products-head">
                <span>Produto</span>
                <span>Cod. barras</span>
                <span>QR Code</span>
                <span aria-hidden="true" />
              </div>
              {products.length === 0 ? (
                <p className="products-empty">Nenhum produto cadastrado.</p>
              ) : (
                products.map((p) => <ProductRow key={p.id} product={p} />)
              )}
            </div>
          </>
        ) : (
          <div className="products-list clients-list">
            <div className="clients-head">
              <span>Nome da loja</span>
              <span>Imprimir?</span>
            </div>
            {clients.length === 0 ? (
              <p className="products-empty">Nenhum cliente importado.</p>
            ) : (
              clients.map((client) => <ClientRow key={client.id} client={client} />)
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function ProductRow({ product }: { product: Product }) {
  const updateProduct = useStore((s) => s.updateProduct);
  const removeProduct = useStore((s) => s.removeProduct);
  const [name, setName] = useState(product.name);
  const [barcode, setBarcode] = useState(product.barcode ?? "");
  const [qrcode, setQrcode] = useState(product.qrcode ?? "");

  const commit = () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setName(product.name);
      return;
    }
    const trimmedBar = barcode.trim();
    const trimmedQr = qrcode.trim();
    if (
      trimmedName !== product.name ||
      trimmedBar !== (product.barcode ?? "") ||
      trimmedQr !== (product.qrcode ?? "")
    ) {
      void updateProduct(product.id, trimmedName, trimmedBar, trimmedQr);
    }
  };

  const blurOnEnter = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
  };

  return (
    <div className="product-item">
      <input
        className="product-cell product-cell-name"
        placeholder="Nome do produto"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={commit}
        onKeyDown={blurOnEnter}
      />
      <input
        className="product-cell product-cell-code"
        placeholder="-"
        title="Valor do codigo de barras deste produto"
        value={barcode}
        onChange={(e) => setBarcode(e.target.value)}
        onBlur={commit}
        onKeyDown={blurOnEnter}
      />
      <input
        className="product-cell product-cell-code"
        placeholder="-"
        title="Valor do QR Code deste produto"
        value={qrcode}
        onChange={(e) => setQrcode(e.target.value)}
        onBlur={commit}
        onKeyDown={blurOnEnter}
      />
      <button
        className="icon-btn product-del"
        title="Excluir"
        aria-label="Excluir produto"
        onClick={() => void removeProduct(product.id)}
      >
        x
      </button>
    </div>
  );
}

function ClientRow({ client }: { client: Client }) {
  const setClientPrintEnabled = useStore((s) => s.setClientPrintEnabled);
  const showToast = useStore((s) => s.showToast);

  const onToggle = async (printEnabled: boolean) => {
    try {
      await setClientPrintEnabled(client.id, printEnabled);
    } catch (err) {
      showToast(
        `Erro ao atualizar cliente: ${err instanceof Error ? err.message : String(err)}`,
        "error"
      );
    }
  };

  return (
    <div className="client-item">
      <span className="client-name">{client.name}</span>
      <span className="client-print">
        <label className="setting-switch client-switch" title="Imprimir loja" aria-label="Imprimir loja">
          <input
            type="checkbox"
            checked={client.printEnabled}
            onChange={(e) => void onToggle(e.target.checked)}
          />
          <span className="switch-track" aria-hidden="true">
            <span className="switch-thumb" />
          </span>
        </label>
      </span>
    </div>
  );
}
