import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates the whole schema. Written as plain SQL so every constraint is visible
 * and reviewable, and `down` is complete so the database can be rebuilt from
 * zero.
 */
export class InitSchema1755300000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE groups (
        id          serial PRIMARY KEY,
        name        varchar(80)  NOT NULL,
        description varchar(255),
        created_at  timestamptz  NOT NULL DEFAULT now(),
        updated_at  timestamptz  NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX ux_groups_name ON groups (lower(name))
    `);

    await queryRunner.query(`CREATE TYPE movement_type AS ENUM ('IN', 'OUT')`);

    await queryRunner.query(`
      CREATE TABLE items (
        id            serial PRIMARY KEY,
        group_id      int           NOT NULL REFERENCES groups (id) ON DELETE RESTRICT,
        name          varchar(120)  NOT NULL,
        description   varchar(255),
        sku           varchar(40)   NOT NULL UNIQUE,
        quantity      int           NOT NULL DEFAULT 0 CHECK (quantity >= 0),
        minimum_stock int           NOT NULL DEFAULT 0 CHECK (minimum_stock >= 0),
        unit_price    numeric(12,2) NOT NULL DEFAULT 0 CHECK (unit_price >= 0),
        created_at    timestamptz   NOT NULL DEFAULT now(),
        updated_at    timestamptz   NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`CREATE INDEX idx_items_group ON items (group_id)`);

    await queryRunner.query(`
      CREATE TABLE movements (
        id              serial PRIMARY KEY,
        item_id         int           NOT NULL REFERENCES items (id) ON DELETE CASCADE,
        type            movement_type NOT NULL,
        quantity        int           NOT NULL CHECK (quantity > 0),
        reason          varchar(255),
        resulting_stock int           NOT NULL CHECK (resulting_stock >= 0),
        created_at      timestamptz   NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`CREATE INDEX idx_movements_item ON movements (item_id)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS movements`);
    await queryRunner.query(`DROP TABLE IF EXISTS items`);
    await queryRunner.query(`DROP TYPE IF EXISTS movement_type`);
    await queryRunner.query(`DROP TABLE IF EXISTS groups`);
  }
}
