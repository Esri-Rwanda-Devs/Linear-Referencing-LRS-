const pages = [
  { id: "analyse", name: "RLRS" },
  { id: "edit", name: "Edit" },
  { id: "cost", name: "Road Reserve" },
];

export default function Sidebar({ viewMode, onChange }) {
  return (
    <nav className="sidebar" aria-label="Pages">
      {pages.map((item) => (
        <button
          key={item.id}
          type="button"
          className={`sidebar-item${viewMode === item.id ? " on" : ""}`}
          aria-current={viewMode === item.id ? "page" : undefined}
          onClick={() => onChange(item.id)}
        >
          {item.name}
        </button>
      ))}
    </nav>
  );
}
