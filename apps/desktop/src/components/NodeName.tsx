import { nodeNameParts } from "./nodeFlags";
import "./NodeName.css";

// Eager URLs ensure Vite includes every asset in the offline application bundle.
const flags = import.meta.glob<string>("../assets/flags/*.svg", {
  eager: true, query: "?url", import: "default",
});

export default function NodeName({ name }: { name: string }) {
  return <>{nodeNameParts(name).map((part, index) => {
    if ("text" in part) return <span key={index}>{part.text}</span>;
    const source = flags[`../assets/flags/${part.region.toLowerCase()}.svg`];
    return source
      ? <img key={index} className="cb-node-flag" src={source} alt={part.region} draggable={false} />
      : <span key={index} className="cb-node-region">{part.region}</span>;
  })}</>;
}
