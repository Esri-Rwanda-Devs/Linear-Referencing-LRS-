import { assetIcons } from "../assets";
import { FiGrid } from "react-icons/fi";

export const appPages = [
  { id: "overview", name: "Overview", icon: FiGrid },
  { id: "analyse", name: "RLRS", icon: assetIcons.TbRoad },
  { id: "cost", name: "RRMS", icon: assetIcons.GiTakeMyMoney },
  { id: "pavement", name: "PMS", icon: assetIcons.GiRoad },
  { id: "traffic", name: "TMS", icon: assetIcons.GiRoad },
  { id: "unsealed", name: "URMS", icon: assetIcons.GiRoad },
  { id: "edit", name: "Edit", icon: assetIcons.MdOutlineEditRoad },
];
