/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  // 1. Create a function to check for duplicates across assets and components
  await knex.raw(`
    CREATE OR REPLACE FUNCTION check_cross_table_id_duplication()
    RETURNS TRIGGER AS $$
    BEGIN
        -- If we are inserting into assets, check components
        IF (TG_TABLE_NAME = 'assets') THEN
            IF EXISTS (SELECT 1 FROM components WHERE LOWER(id) = LOWER(NEW.id)) THEN
                RAISE EXCEPTION 'ID % already exists in components table. Cannot create duplicate in assets.', NEW.id;
            END IF;
        -- If we are inserting into components, check assets
        ELSIF (TG_TABLE_NAME = 'components') THEN
            IF EXISTS (SELECT 1 FROM assets WHERE LOWER(id) = LOWER(NEW.id)) THEN
                RAISE EXCEPTION 'ID % already exists in assets table. Cannot create duplicate in components.', NEW.id;
            END IF;
        END IF;
        RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);

  // 2. Attach trigger to assets
  await knex.raw(`
    DROP TRIGGER IF EXISTS trg_check_assets_dup ON assets;
    CREATE TRIGGER trg_check_assets_dup
    BEFORE INSERT OR UPDATE OF id ON assets
    FOR EACH ROW EXECUTE FUNCTION check_cross_table_id_duplication();
  `);

  // 3. Attach trigger to components
  await knex.raw(`
    DROP TRIGGER IF EXISTS trg_check_components_dup ON components;
    CREATE TRIGGER trg_check_components_dup
    BEFORE INSERT OR UPDATE OF id ON components
    FOR EACH ROW EXECUTE FUNCTION check_cross_table_id_duplication();
  `);
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  await knex.raw('DROP TRIGGER IF EXISTS trg_check_assets_dup ON assets;');
  await knex.raw('DROP TRIGGER IF EXISTS trg_check_components_dup ON components;');
  await knex.raw('DROP FUNCTION IF EXISTS check_cross_table_id_duplication();');
};
