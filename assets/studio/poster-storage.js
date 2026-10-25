const DB = "only-ink-stamp-poster";
let database;
function open() {
  if (!database)
    database = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB, 2);
      request.onupgradeneeded = (event) => {
        if (event.oldVersion < 1) {
          request.result.createObjectStore("images", { keyPath: "id" });
          request.result.createObjectStore("projects");
        }
        if (event.oldVersion < 2)
          request.result.createObjectStore("gallery", { keyPath: "id" });
      };
      request.onsuccess = () => {
        request.result.onversionchange = () => {
          request.result.close();
          database = null;
        };
        resolve(request.result);
      };
      request.onerror = () => {
        database = null;
        reject(request.error);
      };
      request.onblocked = () => {
        database = null;
        reject(Error("请关闭其他旧版工坊标签页后重试"));
      };
    });
  return database;
}
async function transaction(stores, mode, action) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(stores, mode);
    let result;
    tx.oncomplete = () => resolve(result);
    tx.onerror = tx.onabort = () => reject(tx.error || Error("本地保存失败"));
    try {
      result = action(tx);
    } catch (error) {
      tx.abort();
      reject(error);
    }
  });
}
export async function restore() {
  const requests = await transaction(
    ["images", "projects", "gallery"],
    "readonly",
    (tx) => [
      tx.objectStore("images").getAll(),
      tx.objectStore("projects").get("current"),
      tx.objectStore("gallery").getAll(),
    ],
  );
  return {
    images: requests[0].result.sort((a, b) => a.createdAt - b.createdAt),
    project: requests[1].result,
    gallery: requests[2].result.sort((a, b) => b.createdAt - a.createdAt),
  };
}
export async function save(project, images, removed = [], gallery = {}) {
  const { items = [], removed: removedItems = [] } = gallery;
  return transaction(["images", "projects", "gallery"], "readwrite", (tx) => {
    const store = tx.objectStore("images");
    images.forEach((image) => store.put(image));
    removed.forEach((id) => store.delete(id));
    const galleryStore = tx.objectStore("gallery");
    items.forEach((item) => galleryStore.put(item));
    removedItems.forEach((id) => galleryStore.delete(id));
    tx.objectStore("projects").put(project, "current");
  });
}
