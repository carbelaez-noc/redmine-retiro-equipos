# frozen_string_literal: true

module RedmineIssueReasonCatalog
  # Resuelve el tracker destino a partir del motivo de apertura.
  # Lee las declaraciones de cada plugin de especialidad (trigger_motivos
  # + enabled_tracker_ids): sin listas cableadas, si un plugin cambia su
  # Setting, el amarre se actualiza solo. Gana el primer tracker habilitado.
  module TrackerResolver
    SOURCES = [
      'FibrazoDevoluciones::SettingsHelper',
      'FibrazoTrasladoHogares::SettingsHelper',
      'FibrazoTitularidad::SettingsHelper',
      'FibrazoTvFallas::SettingsHelper',
      'FibrazoRetiroEquipos::SettingsHelper'
    ].freeze

    module_function

    # @return {tracker:, owner_ids:} o nil si el motivo no tiene dueno.
    def resolve(motivo, subcategoria)
      candidates = [motivo, subcategoria].map { |s| norm(s) }.reject(&:blank?)
      return nil if candidates.empty?

      SOURCES.each do |const_name|
        mod = const_get_safe(const_name)
        next unless mod && mod.respond_to?(:trigger_motivos) && mod.respond_to?(:enabled_tracker_ids)

        triggers = Array(mod.trigger_motivos).map { |s| norm(s) }.reject(&:blank?)
        triggers |= [norm(mod.trigger_subcategoria)] if mod.respond_to?(:trigger_subcategoria)
        next if (triggers & candidates).empty?

        ids = Array(mod.enabled_tracker_ids).map(&:to_i).reject(&:zero?)
        next if ids.empty?

        # Tracker destino explicito del plugin (configurable en su settings);
        # evita depender del orden de la lista de habilitados.
        dest = mod.switch_tracker_name if mod.respond_to?(:switch_tracker_name)
        tracker = Tracker.find_by(name: dest.to_s.strip) if dest.to_s.strip.present?
        tracker ||= Tracker.find_by(id: ids.first)
        return { tracker: tracker, owner_ids: ids } if tracker
      end
      nil
    end

    def norm(value)
      value.to_s.strip.downcase.gsub(/\s+/, ' ').sub(/\.\z/, '')
    end

    def const_get_safe(name)
      name.split('::').inject(Object) { |o, c| o.const_get(c) }
    rescue NameError
      nil
    end
  end
end
