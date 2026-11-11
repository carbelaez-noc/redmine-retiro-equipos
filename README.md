# fibrazo_retiro_equipos
Dueño del dominio "Retiro de equipos" ante el catálogo de motivos.
Al tipificar un motivo de retiro en un caso nuevo, el tracker cambia
al destino configurado (default: Retiro de ONU/TV Box, id 38 en PROD).
Admin (Plugins > Configurar): activado, tracker destino, trackers del
dominio, subcategoría y motivos disparadores (del catálogo, normal y AX).
Deploy: plugin nuevo + 1 línea en
redmine_issue_reason_catalog/.../tracker_resolver.rb SOURCES
('FibrazoRetiroEquipos::SettingsHelper'). Ver catalog_tracker_resolver.patched.rb.
