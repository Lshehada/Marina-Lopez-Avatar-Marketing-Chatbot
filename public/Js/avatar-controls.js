// Keep command recognition shared between the widget and its LLM callback.
export function isAvatarStopCommand(text) {
  const command = String(text || '').toLowerCase().normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').replace(/[.,!?;:]/g, '')
    .replace(/\s+/g, ' ').trim();
  return /^(?:(?:hey )?marina )?(?:please )?(?:stop(?: talking| speaking)?|be quiet|arret(?:e|ez)(?: de parler)?|tais-toi|silence|stopp|hor auf|basta|smetti(?: di parlare)?|para(?: de hablar)?|deja de hablar)(?: please| s'il te plait| s'il vous plait)?(?: marina)?$/.test(command);
}
