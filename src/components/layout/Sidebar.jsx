import { useState } from "react";
import { FiChevronLeft, FiChevronRight } from "react-icons/fi";
import { assetIcons, assetImages } from "../../assets";
import { appPages } from "../../app/routes";
import { signOutOfLrs } from "../../features/mapping/services/lrsService";
import "./Sidebar.css";

const SIDEBAR_STORE = "rwanda-lrs-sidebar-closed";

export default function Sidebar({ viewMode, onChange }) {
  const [closed, setClosed] = useState(() => localStorage.getItem(SIDEBAR_STORE) === "1");

  const toggle = () => {
    setClosed((current) => {
      const next = !current;
      try {
        localStorage.setItem(SIDEBAR_STORE, next ? "1" : "0");
      } catch {
        // The sidebar still closes for this visit.
      }
      return next;
    });
  };

  return (
    <div className={`sidebar${closed ? " closed" : ""}`} aria-label="Pages">
      <div className="sidebar-logo">
        <img src={assetImages.rtdaLogo} alt="Logo" className="sidebar-logo-image" />
        <h1 className="sidebar-logo-text">RTDA</h1>
        <button
          type="button"
          className="sidebar-toggle"
          aria-label={closed ? "Open sidebar" : "Close sidebar"}
          title={closed ? "Open sidebar" : "Close sidebar"}
          onClick={toggle}
        >
          {closed ? <FiChevronRight /> : <FiChevronLeft />}
        </button>
      </div>
      <div className="sidebar-items">
        {appPages.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`sidebar-item${viewMode === item.id ? " on" : ""}`}
            aria-current={viewMode === item.id ? "page" : undefined}
            title={item.name}
            onClick={() => onChange(item.id)}
          >
            <item.icon className="sidebar-item-icon" />
            <span className="sidebar-item-label">{item.name}</span>
          </button>
        ))}
      </div>
      <div className="sidebar-logout">
        <button type="button" className="sidebar-logout-button" title="Log out" onClick={() => signOutOfLrs()}>
          <assetIcons.FiLogOut className="sidebar-logout-button-icon" />
          <span className="sidebar-logout-label">Log out</span>
        </button>
      </div>
    </div>
  );
}
