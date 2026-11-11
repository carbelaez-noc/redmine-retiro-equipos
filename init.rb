require_relative 'lib/fibrazo_retiro_equipos/settings_helper'

Redmine::Plugin.register :fibrazo_retiro_equipos do
  name 'Fibrazo Retiro de Equipos'
  author 'Fibrazo NOC'
  description 'Dueño del dominio Retiro de equipos: cambio automático de tracker al tipificar motivo de retiro (vía catálogo de motivos)'
  version '0.1.0'
  url 'https://helpdesk.soporte24.cloud'
  author_url 'mailto:noc@fibrazo.com.co'

  settings default: {
    'enabled' => '1',
    'switch_tracker_name' => FibrazoRetiroEquipos::SettingsHelper::DEST_TRACKER_NAME,
    'tracker_names' => [FibrazoRetiroEquipos::SettingsHelper::DEST_TRACKER_NAME],
    'trigger_subcategoria' => FibrazoRetiroEquipos::SettingsHelper::DEFAULT_TRIGGER_SUBCATEGORIA,
    'trigger_motivos' => FibrazoRetiroEquipos::SettingsHelper::DEFAULT_TRIGGER_MOTIVOS
  }, partial: 'settings/fibrazo_retiro_equipos_settings'
end
