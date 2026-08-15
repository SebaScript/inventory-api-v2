import { ApiProperty } from '@nestjs/swagger';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { numericTransformer } from '../../../common/database/numeric.transformer';
import { Group } from '../../groups/entities/group.entity';
import { Movement } from '../../movements/entities/movement.entity';

/**
 * A stock-keeping unit inside a group.
 *
 * `quantity` is a **derived, cached value**: it is only ever written inside the
 * transaction that records a `Movement`, never edited directly through the item
 * endpoints. That keeps the movement ledger and the current stock in agreement
 * by construction — see `MovementsService.create`.
 */
@Entity('items')
export class Item {
  @ApiProperty({ example: 1, description: 'Unique item identifier' })
  @PrimaryGeneratedColumn({ type: 'int' })
  id: number;

  @ApiProperty({ example: 1, description: 'Identifier of the owning group' })
  @Column({ name: 'group_id', type: 'int' })
  @Index('idx_items_group_id')
  groupId: number;

  @ApiProperty({ example: 'USB-C Cable 2m', maxLength: 120 })
  @Column({ type: 'varchar', length: 120 })
  name: string;

  @ApiProperty({ example: 'Braided USB-C to USB-C cable', maxLength: 500, nullable: true })
  @Column({ type: 'varchar', length: 500, nullable: true })
  description: string | null;

  @ApiProperty({
    example: 'ELEC-USBC-2M',
    maxLength: 40,
    description: 'Globally unique stock keeping unit, normalised to uppercase',
  })
  @Column({ type: 'varchar', length: 40, unique: true })
  sku: string;

  @ApiProperty({
    example: 42,
    minimum: 0,
    description: 'Current stock. Read-only: changed exclusively through movements.',
  })
  @Column({ type: 'int', default: 0 })
  quantity: number;

  @ApiProperty({
    example: 10,
    minimum: 0,
    description: 'Threshold at or below which the item is reported as low stock',
  })
  @Column({ name: 'minimum_stock', type: 'int', default: 0 })
  minimumStock: number;

  @ApiProperty({ example: 12.5, minimum: 0, description: 'Unit price with two decimal places' })
  @Column({
    name: 'unit_price',
    type: 'numeric',
    precision: 12,
    scale: 2,
    default: 0,
    transformer: numericTransformer,
  })
  unitPrice: number;

  @ApiProperty({ example: '2026-08-16T10:00:00.000Z' })
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @ApiProperty({ example: '2026-08-16T10:00:00.000Z' })
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @ApiProperty({ type: () => Group, required: false })
  @ManyToOne(() => Group, (group) => group.items, {
    onDelete: 'RESTRICT',
    nullable: false,
  })
  @JoinColumn({ name: 'group_id' })
  group?: Group;

  @OneToMany(() => Movement, (movement) => movement.item)
  movements?: Movement[];
}
