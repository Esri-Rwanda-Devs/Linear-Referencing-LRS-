import { assetImages } from "../../assets";
import { appPages } from "../../app/routes";

export default function Sidebar({ viewMode, onChange }) {
  return (
    <div className="sidebar" aria-label="Pages">
      <div className="sidebar-logo">
        <img src={assetImages.rtdaLogo} alt="Logo" className="sidebar-logo-image" />
        <h1 className="sidebar-logo-text">RTDA</h1>
      </div>
      {appPages.map((item) => (
        <button
          key={item.id}
          type="button"
          className={`sidebar-item${viewMode === item.id ? " on" : ""}`}
          aria-current={viewMode === item.id ? "page" : undefined}
          onClick={() => onChange(item.id)}
        >
          <item.icon /> {item.name}
        </button>
      ))}
    </div>
  );
}
