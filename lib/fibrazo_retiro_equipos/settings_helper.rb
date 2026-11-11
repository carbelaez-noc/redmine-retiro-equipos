# frozen_string_literal: true

module FibrazoRetiroEquipos
  # Dueño del dominio "Retiro de equipos" ante el catálogo de motivos.
  # Declara qué motivos/subcategoría disparan el cambio automático de
  # tracker (vía RedmineIssueReasonCatalog::TrackerResolver) y a qué
  # tracker destino. Todo configurable en Ajustes; los defaults cubren
  # los 6 motivos de retiro del catálogo (equipos normal y AX).
  module SettingsHelper
    module_function

    DEST_TRACKER_NAME = 'Retiro de ONU/TV Box'

    DEFAULT_TRIGGER_MOTIVOS = [
      'Retiro de ONU',
      'Retiro de ONU + TV Box',
      'Retiro de TV Box'
    ].freeze

    DEFAULT_TRIGGER_SUBCATEGORIA = 'Retiro de equipo'

    def settings
      Setting.plugin_fibrazo_retiro_equipos || {}
    rescue StandardError
      {}
    end

    def blank_setting?(raw)
      raw.nil? || raw == '' || raw == []
    end

    # Interruptor maestro: apagado = sin triggers = el resolver no cambia nada.
    def enabled?
      raw = settings['enabled']
      return true if blank_setting?(raw)

      raw.to_s == '1'
    end

    def list_setting(key, default_list)
      return default_list unless settings.key?(key.to_s)

      raw = settings[key.to_s]
      list =
        case raw
        when Array then raw
        when String then raw.split("\n")
        else []
        end
      cleaned = list.map(&:to_s).map(&:strip).reject(&:blank?)
      cleaned.presence || default_list
    end

    # Motivos que disparan el cambio a Retiro. Vacío + apagado = sin switch.
    def trigger_motivos
      return [] unless enabled?

      list_setting('trigger_motivos', DEFAULT_TRIGGER_MOTIVOS)
    end

    def trigger_subcategoria
      return nil unless enabled?

      settings['trigger_subcategoria'].presence || DEFAULT_TRIGGER_SUBCATEGORIA
    end

    # Motivos seleccionables en el admin: razones de apertura vivas del
    # catálogo cuya subcategoría menciona retiro (cubre normal y AX).
    def trigger_opciones
      if defined?(IssueReasonCatalogEntry)
        reasons = IssueReasonCatalogEntry.active.where(kind: 'opening')
                                              .where('subcategory ILIKE ?', '%retiro%')
                                              .distinct.order(:reason).pluck(:reason)
        return reasons.map(&:to_s) if reasons.any?
      end
      DEFAULT_TRIGGER_MOTIVOS.dup
    rescue StandardError
      DEFAULT_TRIGGER_MOTIVOS.dup
    end

    def trigger_subcategoria_opciones
      if defined?(IssueReasonCatalogEntry)
        subs = IssueReasonCatalogEntry.active.where(kind: 'opening')
                                       .where('subcategory ILIKE ?', '%retiro%')
                                       .distinct.order(:subcategory).pluck(:subcategory)
        return subs.map(&:to_s) if subs.any?
      end
      [DEFAULT_TRIGGER_SUBCATEGORIA]
    rescue StandardError
      [DEFAULT_TRIGGER_SUBCATEGORIA]
    end

    # Trackers donde opera el dominio, por nombre (robusto ante ids).
    def enabled_tracker_ids
      names = list_setting('tracker_names', [DEST_TRACKER_NAME])
      ids = names.filter_map { |name| Tracker.find_by(name: name)&.id }
      ids.presence || Array(Tracker.find_by(name: DEST_TRACKER_NAME)&.id).compact
    rescue StandardError
      []
    end

    # Tracker destino del cambio automático por motivo (obligatorio).
    def switch_tracker_name
      settings['switch_tracker_name'].presence || DEST_TRACKER_NAME
    end

    def destination_tracker
      Tracker.find_by(name: switch_tracker_name.to_s.strip)
    end
  end
end
