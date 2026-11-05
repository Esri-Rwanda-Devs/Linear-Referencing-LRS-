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
      <div className="sidebar-fade" aria-hidden="true">
        <svg viewBox="0 0 240 130" preserveAspectRatio="none">
          <path fill="#12345a" d="M0 50 C40 28 70 62 110 46 C150 30 180 58 240 36 L240 130 L0 130 Z" />
          <path fill="#1c4d3a" d="M0 78 C50 60 90 90 140 72 C180 58 210 80 240 66 L240 130 L0 130 Z" />
          <path fill="#0b1c30" d="M0 100 C60 86 120 108 180 92 C210 86 228 96 240 90 L240 130 L0 130 Z" />
        </svg>
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
