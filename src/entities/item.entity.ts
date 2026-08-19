import { ApiProperty } from '@nestjs/swagger';
import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { numericColumn } from '../common/pagination';
import { Group } from './group.entity';

export enum ItemStatus {
  ACTIVE = 'ACTIVE',
  DISCONTINUED = 'DISCONTINUED',
}

/**
 * `quantity` is derived: written only inside the transaction that records a
 * Movement. Items are never physically deleted — DELETE marks them
 * DISCONTINUED so their history stays auditable.
 */
@Entity('items')
export class Item {
  @ApiProperty({ example: 1 })
  @PrimaryGeneratedColumn()
  id: number;

  @ApiProperty({ example: 1 })
  @Column({ name: 'group_id' })
  groupId: number;

  @ApiProperty({ example: 'USB-C Cable' })
  @Column({ length: 120 })
  name: string;

  @ApiProperty({ example: 'ELEC-USBC-2M', description: 'Unique, stored uppercase' })
  @Column({ length: 40, unique: true })
  sku: string;

  @ApiProperty({ example: 42, description: 'Read-only: changed only through movements' })
  @Column({ default: 0 })
  quantity: number;

  @ApiProperty({ example: 10, description: 'At or below this, the item is low stock' })
  @Column({ name: 'minimum_stock', default: 0 })
  minimumStock: number;

  @ApiProperty({ example: 12.5 })
  @Column({
    name: 'unit_price',
    type: 'numeric',
    precision: 12,
    scale: 2,
    default: 0,
    transformer: numericColumn,
  })
  unitPrice: number;

  @ApiProperty({ enum: ItemStatus, example: ItemStatus.ACTIVE })
  @Column({ type: 'enum', enum: ItemStatus, enumName: 'item_status', default: ItemStatus.ACTIVE })
  status: ItemStatus;

  @ApiProperty()
  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @ApiProperty()
  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @ApiProperty({ type: () => Group, required: false })
  @ManyToOne(() => Group, (group) => group.items)
  @JoinColumn({ name: 'group_id' })
  group?: Group;
}
