(function(){
  'use strict';

  const AGENDA_BOOT = Object.freeze({
    module: 'Agenda',
    storageNamespace: 'a33_agenda_',
    stage: '1/8',
    isolated: true
  });

  function formatToday(date){
    try {
      return new Intl.DateTimeFormat('es-NI', {
        weekday: 'long',
        day: '2-digit',
        month: 'long',
        year: 'numeric'
      }).format(date);
    } catch (_) {
      return date.toLocaleDateString('es-NI');
    }
  }

  function setToday(){
    const el = document.getElementById('agendaToday');
    if (!el) return;
    const today = formatToday(new Date());
    el.textContent = today.charAt(0).toUpperCase() + today.slice(1);
  }

  function markReady(){
    document.documentElement.setAttribute('data-agenda-ready', '1');
    window.A33Agenda = AGENDA_BOOT;
  }

  document.addEventListener('DOMContentLoaded', function(){
    try { setToday(); } catch (_) {}
    try { markReady(); } catch (_) {}
  }, { once:true });
})();
