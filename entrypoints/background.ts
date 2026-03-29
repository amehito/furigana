export default defineBackground(() => {
  console.log('Hello background!', { id: browser.runtime.id });
  
  if (import.meta.env.MODE === 'development') {
    browser.tabs.create({ url: 'lab.html' })
  }
});
