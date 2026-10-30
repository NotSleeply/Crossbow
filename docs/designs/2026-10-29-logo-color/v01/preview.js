const choices = {
  a: { color: "#455AB5", name: "当前色" },
  b: { color: "#3F52CF", name: "鲜明靛蓝" },
  c: { color: "#3448D8", name: "浓郁靛蓝" },
};
function select(id) {
  const choice = choices[id];
  document
    .querySelectorAll("[data-option]")
    .forEach((el) => el.classList.toggle("selected", el.dataset.option === id));
  document.querySelectorAll("[data-select]").forEach((button) => {
    const active = button.dataset.select === id;
    button.setAttribute("aria-pressed", String(active));
    button.textContent = active
      ? "正在预览 · " + choices[button.dataset.select].name
      : "查看" + choices[button.dataset.select].name;
  });
  document
    .querySelectorAll(".selected-mark")
    .forEach((img) => (img.src = "assets/" + id + "-mark.svg"));
  document.querySelector(".selected-icon").src =
    "assets/" + id + "-app-icon.svg";
  document.getElementById("selection").textContent =
    id.toUpperCase() + " · " + choice.name + " " + choice.color;
  document.getElementById("dock-caption").textContent = choice.name;
}
document
  .querySelectorAll("[data-select]")
  .forEach((button) =>
    button.addEventListener("click", () => select(button.dataset.select)),
  );
