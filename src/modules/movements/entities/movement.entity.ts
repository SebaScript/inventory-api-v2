import { ApiProperty } from '@nestjs/swagger';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Item } from '../../items/entities/item.entity';

/**
 * Direction of a stock movement.
 *
 * Stored as a PostgreSQL enum type (`movement_type`) rather than a lookup
 * table, so the domain still consists of exactly three tables while the
 * database — not just the application — rejects any other value.
 */
export enum MovementType {
  IN = 'IN',
  OUT = 'OUT',
}

/**
 * An immutable ledger entry describing a single stock change.
 *
 * Movements are append-only: there is no update or delete endpoint, because
 * rewriting history would break the guarantee that `Item.quantity` equals the
 * sum of its movements. Corrections are made by recording a compensating
 * movement, which is how real inventory systems behave.
 */
@Entity('movements')
@Index('idx_movements_item_id_created_at', ['itemId', 'createdAt'])
export class Movement {
  @ApiProperty({ example: 1, description: 'Unique movement identifier' })
  @PrimaryGeneratedColumn({ type: 'int' })
  id: number;

  @ApiProperty({ example: 1, description: 'Identifier of the affected item' })
  @Column({ name: 'item_id', type: 'int' })
  itemId: number;

  @ApiProperty({ enum: MovementType, example: MovementType.IN })
  @Index('idx_movements_type')
  @Column({ type: 'enum', enum: MovementType, enumName: 'movement_type' })
  type: MovementType;

  @ApiProperty({ example: 25, minimum: 1, description: 'Number of units moved; always positive' })
  @Column({ type: 'int' })
  quantity: number;

  @ApiProperty({ example: 'Supplier delivery #4471', maxLength: 255, nullable: true })
  @Column({ type: 'varchar', length: 255, nullable: true })
  reason: string | null;

  @ApiProperty({
    example: 67,
    minimum: 0,
    description:
      'Stock level of the item immediately after this movement was applied. ' +
      'Makes the ledger auditable and lets stock history be reconstructed without replaying every row.',
  })
  @Column({ name: 'resulting_stock', type: 'int' })
  resultingStock: number;

  @ApiProperty({ example: '2026-08-16T10:00:00.000Z' })
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @ApiProperty({ type: () => Item, required: false })
  @ManyToOne(() => Item, (item) => item.movements, {
    onDelete: 'CASCADE',
    nullable: false,
  })
  @JoinColumn({ name: 'item_id' })
  item?: Item;
}
