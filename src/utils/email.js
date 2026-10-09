export function extractEmail(text=''){
  return text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0]?.toLowerCase()||null;
}
export function isBusinessEmail(email){
  const free=new Set(['gmail.com','yahoo.com','outlook.com','hotmail.com','icloud.com','gmx.com','proton.me']);
  return !free.has(email.split('@')[1]);
}
