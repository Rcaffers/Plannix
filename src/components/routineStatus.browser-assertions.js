export function assertHiddenStatuses(root = document) {
  for (const node of root.querySelectorAll('.visually-hidden[role="status"]')) {
    const style = getComputedStyle(node);
    if (style.position !== 'absolute' || style.clipPath !== 'inset(50%)'
      || style.display === 'none' || style.visibility === 'hidden'
      || node.closest('[aria-hidden="true"],[hidden],[inert]') || node.hasAttribute('tabindex')
      || node.ownerDocument.activeElement === node
      || node.querySelector('button,a,input,select,textarea')) throw Error('Routine announcement must be accessible, non-focusable and out of flow');
    if (node.offsetWidth > 1 || node.offsetHeight > 1) throw Error('Routine announcement occupies layout space');
  }
}
